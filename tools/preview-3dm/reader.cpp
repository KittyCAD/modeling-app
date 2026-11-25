#include <opennurbs.h>
#include <emscripten/bind.h>
#include <nlohmann/json.hpp>
#include <charconv>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace {
using Json = nlohmann::json;

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

// Serialize directly into the snapshot to avoid allocating a JSON node per coordinate.
struct Array {
    std::string data = "[";
    void add(const std::string& value) {
        if (data.size() > 1) data += ',';
        data += value;
    }
    std::string finish() { data += ']'; return std::move(data); }
};

std::string number(double value) {
    require(std::isfinite(value), "Invalid spline coordinate");
    char buffer[32];
    auto result = std::to_chars(buffer, buffer + sizeof(buffer), value);
    require(result.ec == std::errc{}, "Cannot encode coordinate");
    return {buffer, result.ptr};
}

template<typename T> std::string pair(T a, T b) {
    return "[" + std::to_string(a) + "," + std::to_string(b) + "]";
}

// OpenNURBS omits the two superfluous end knots used by the evaluator.
void appendKnots(Array& result, const double* values, int count) {
    require(values && count > 0, "Missing spline knots");
    result.add(number(values[0]));
    for (int i = 0; i < count; ++i) result.add(number(values[i]));
    result.add(number(values[count - 1]));
}

std::string surfaceData(const ON_NurbsSurface& s, double scale) {
    Array points, weights, knots;
    for (int u = 0; u < s.CVCount(0); ++u) {
        for (int v = 0; v < s.CVCount(1); ++v) {
            ON_3dPoint p;
            require(s.GetCV(u, v, p), "Invalid surface control point");
            points.add("[" + number(p.x * scale) + "," + number(p.y * scale) + "," + number(p.z * scale) + "]");
            if (s.IsRational()) weights.add(number(s.Weight(u, v)));
        }
    }
    for (int axis = 0; axis < 2; ++axis) appendKnots(knots, s.m_knot[axis], s.KnotCount(axis));
    return R"({"type":"nurbs","nurbs":{"controlPoints":)" + points.finish() +
        R"(,"weights":)" + weights.finish() + R"(,"knotVector":)" + knots.finish() +
        R"(,"order":)" + pair(s.Order(0), s.Order(1)) +
        R"(,"numControlPoints":)" + pair(s.CVCount(0), s.CVCount(1)) +
        R"(,"numKnots":)" + pair(s.KnotCount(0) + 2, s.KnotCount(1) + 2) +
        R"(,"closed":)" + Json::array({s.IsClosed(0), s.IsClosed(1)}).dump() + "}}";
}

ON_NurbsCurve trimCurve(const ON_BrepTrim& trim, const ON_Surface& surface, int form) {
    ON_NurbsCurve curve;
    if (form == 1) {
        require(trim.GetNurbForm(curve) != 0, "Invalid trim spline");
        return curve;
    }
    // A surface of revolution can change its angular parameter on conversion.
    // Sample each trim span in its original domain and map those UVs with OpenNURBS.
    int spans = trim.SpanCount();
    require(spans > 0 && spans <= 512, "Unsupported trim span count");
    std::vector<double> boundaries(spans + 1);
    require(trim.GetSpanVector(boundaries.data()), "Invalid trim spans");
    ON_Polyline polyline;
    for (int span = 0; span < spans; ++span) {
        ON_Interval interval(boundaries[span], boundaries[span + 1]);
        for (int i = span == 0 ? 0 : 1; i <= 16; ++i) {
            auto p = trim.PointAt(interval.ParameterAt(i / 16.0));
            double u, v;
            require(surface.GetNurbFormParameterFromSurfaceParameter(p.x, p.y, &u, &v),
                    "Cannot map trim onto converted surface");
            polyline.Append(ON_3dPoint(u, v, 0));
        }
    }
    ON_PolylineCurve mapped(polyline);
    require(mapped.GetNurbForm(curve) != 0, "Invalid mapped trim");
    return curve;
}

std::string bodyData(const ON_Brep& brep, double scale) {
    Array surfaces, curves;
    size_t curveIndex = 0;
    Json faces = Json::array(), loops = Json::array();
    for (int i = 0; i < brep.m_F.Count(); ++i) {
        const auto& face = brep.m_F[i];
        const auto* source = face.SurfaceOf();
        ON_NurbsSurface surface;
        int form = source ? source->GetNurbForm(surface) : 0;
        require(form != 0, "Invalid face surface");
        Json refs = Json::array();
        const auto* outer = face.OuterLoop();
        require(outer, "Missing outer boundary");
        auto appendLoop = [&](const ON_BrepLoop& loop) {
            Json traces = Json::array();
            for (int t = 0; t < loop.TrimCount(); ++t) {
                const auto* trim = loop.Trim(t);
                require(trim, "Missing trim");
                auto c = trimCurve(*trim, *source, form);
                Array points, weights, knots;
                for (int k = 0; k < c.CVCount(); ++k) {
                    ON_3dPoint p;
                    require(c.GetCV(k, p), "Invalid trim control point");
                    points.add("[" + number(p.x) + "," + number(p.y) + "]");
                    if (c.IsRational()) weights.add(number(c.Weight(k)));
                }
                traces.push_back({{"curve", {curveIndex++, 1}}, {"t", {c.Domain().Min(), c.Domain().Max()}}});
                appendKnots(knots, c.m_knot, c.KnotCount());
                curves.add(R"({"type":"nurbs","nurbs":{"controlPoints":)" + points.finish() +
                    R"(,"weights":)" + weights.finish() + R"(,"order":)" + std::to_string(c.Order()) +
                    R"(,"knotVector":)" + knots.finish() + "}}");
            }
            refs.push_back({loops.size(), 1});
            loops.push_back({{"traces", traces}});
        };
        appendLoop(*outer);
        for (int l = 0; l < face.LoopCount(); ++l) {
            const auto* loop = face.Loop(l);
            require(loop, "Missing face boundary");
            if (loop != outer) appendLoop(*loop);
        }
        faces.push_back({{"surface", {i, face.m_bRev ? -1 : 1}}, {"loops", refs}});
        surfaces.add(surfaceData(surface, scale));
    }
    return R"({"faces":)" + faces.dump() + R"(,"surfaces":)" + surfaces.finish() +
        R"(,"loops":)" + loops.dump() + R"(,"curves2D":)" + curves.finish() + "}";
}

std::string readPreview(emscripten::val bytes) {
    std::vector<unsigned char> buffer(bytes["byteLength"].as<size_t>());
    emscripten::val(emscripten::typed_memory_view(buffer.size(), buffer.data())).call<void>("set", bytes);
    ON_Read3dmBufferArchive archive(buffer.size(), buffer.data(), false, 0, 0);
    ONX_Model model;
    require(model.Read(archive), "Invalid 3DM archive");
    const auto scale = ON::UnitScale(model.m_settings.m_ModelUnitsAndTolerances.m_unit_system,
                                     ON_UnitSystem(ON::LengthUnitSystem::Meters));
    Array bodies;
    Json errors = Json::array();
    ONX_ModelComponentIterator objects(model, ON_ModelComponent::Type::ModelGeometry);
    for (auto ref = objects.FirstComponentReference(); !ref.IsEmpty(); ref = objects.NextComponentReference()) {
        const auto* object = ON_ModelGeometryComponent::Cast(ref.ModelComponent());
        const auto* brep = object ? ON_Brep::Cast(object->Geometry(nullptr)) : nullptr;
        if (!brep) continue;
        char uuid[37];
        ON_UuidToString(object->Id(), uuid);
        try { bodies.add(R"({"id":)" + Json(uuid).dump() + R"(,"brep":)" + bodyData(*brep, scale) + "}"); }
        catch (const std::exception& e) { errors.push_back(std::string(uuid) + ": " + e.what()); }
    }
    return R"({"version":1,"coordinateSystem":"z-up","bodies":)" + bodies.finish() + R"(,"errors":)" + errors.dump() + "}";
}
}

EMSCRIPTEN_BINDINGS(preview_reader) {
    ON::Begin();
    emscripten::function("readPreview", &readPreview);
}
