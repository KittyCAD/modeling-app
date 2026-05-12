#include "occt_command_core.h"

#include <cmath>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#if ZOO_OCCT_CORE_WITH_OCCT
#include <BRepGProp.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Edge.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <TopoDS_Shape.hxx>
#endif

namespace {

constexpr double kPi = 3.14159265358979323846264338327950288;

struct ShapeSummary {
  std::string command_id;
  std::string kind;
  std::string body_type;
  double volume = 0.0;
};

struct CommandBlock {
  std::string command_id;
  std::string type;
  std::string json;
  std::size_t position = 0;
};

struct Point3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct PlaneSummary {
  Point3 origin;
  Point3 x_axis{1.0, 0.0, 0.0};
  Point3 y_axis{0.0, 1.0, 0.0};
};

struct PathSegmentSummary {
  std::string type;
  Point3 start;
  Point3 end;
  Point3 center;
  double radius = 0.0;
  double start_angle = 0.0;
  double end_angle = 0.0;
  bool full_circle = false;
};

struct PathSummary {
  std::string plane_id;
  bool has_start = false;
  Point3 start;
  Point3 pen;
  std::vector<Point3> points;
  std::vector<PathSegmentSummary> segments;
  bool closed = false;
};

struct RegionSummary {
  std::string source_path_id;
  std::string plane_id;
  std::vector<Point3> points;
  std::vector<PathSegmentSummary> segments;
};

struct CoreState {
  std::string current_sketch_plane_id;
  std::unordered_map<std::string, PlaneSummary> planes;
  std::unordered_map<std::string, PathSummary> paths;
  std::unordered_map<std::string, RegionSummary> regions;
  std::vector<ShapeSummary> shapes;
#if ZOO_OCCT_CORE_WITH_OCCT
  std::vector<TopoDS_Shape> occt_shapes;
#endif
};

CoreState& state() {
  static CoreState core_state;
  return core_state;
}

std::string as_string(const char* value) {
  return value == nullptr ? std::string() : std::string(value);
}

char* copy_string(const std::string& value) {
  auto* out = static_cast<char*>(std::malloc(value.size() + 1));
  if (out == nullptr) {
    return nullptr;
  }
  std::memcpy(out, value.c_str(), value.size() + 1);
  return out;
}

std::string escape_json(const std::string& value) {
  std::ostringstream out;
  for (const char c : value) {
    switch (c) {
      case '"':
        out << "\\\"";
        break;
      case '\\':
        out << "\\\\";
        break;
      case '\b':
        out << "\\b";
        break;
      case '\f':
        out << "\\f";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        out << c;
    }
  }
  return out.str();
}

std::string quoted(const std::string& value) {
  return "\"" + escape_json(value) + "\"";
}

std::size_t find_string_end(const std::string& json, std::size_t open_quote) {
  bool escaped = false;
  for (std::size_t pos = open_quote + 1; pos < json.size(); ++pos) {
    const char c = json[pos];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c == '\\') {
      escaped = true;
      continue;
    }
    if (c == '"') {
      return pos;
    }
  }
  return std::string::npos;
}

std::string extract_string_value_at_key(const std::string& json, std::size_t key_pos, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  if (json.compare(key_pos, needle.size(), needle) != 0) {
    return "";
  }

  const std::size_t colon = json.find(':', key_pos + needle.size());
  if (colon == std::string::npos) {
    return "";
  }

  const std::size_t open = json.find('"', colon + 1);
  if (open == std::string::npos) {
    return "";
  }

  const std::size_t close = find_string_end(json, open);
  if (close == std::string::npos) {
    return "";
  }

  return json.substr(open + 1, close - open - 1);
}

std::vector<std::string> extract_string_values(const std::string& json, const std::string& key) {
  std::vector<std::string> values;
  const std::string needle = "\"" + key + "\"";
  std::size_t pos = 0;
  while ((pos = json.find(needle, pos)) != std::string::npos) {
    const auto value = extract_string_value_at_key(json, pos, key);
    if (!value.empty()) {
      values.push_back(value);
    }
    pos += needle.size();
  }
  return values;
}

std::string extract_first_string_value(const std::string& json, const std::string& key, const std::string& fallback) {
  const auto values = extract_string_values(json, key);
  return values.empty() ? fallback : values.front();
}

std::string detect_request_kind(const std::string& request_json) {
  if (request_json.find("\"modeling_cmd_batch_req\"") != std::string::npos) {
    return "batch";
  }
  if (request_json.find("\"modeling_cmd_req\"") != std::string::npos) {
    return "modeling";
  }
  return "other";
}

std::string detect_command_type(const std::string& request_json) {
  auto types = extract_string_values(request_json, "type");
  if (types.size() >= 2) {
    return types[1];
  }
  if (!types.empty()) {
    return types[0];
  }
  return "unknown";
}

std::string command_ids_json(const std::vector<std::string>& command_ids) {
  std::ostringstream out;
  out << "[";
  for (std::size_t i = 0; i < command_ids.size(); ++i) {
    if (i > 0) {
      out << ",";
    }
    out << quoted(command_ids[i]);
  }
  out << "]";
  return out.str();
}

std::string geometry_backend() {
#if ZOO_OCCT_CORE_WITH_OCCT
  return "native_occt";
#else
  return "protocol_geometry";
#endif
}

double extract_number_value(const std::string& json, const std::string& key, double fallback) {
  const std::string needle = "\"" + key + "\"";
  const std::size_t key_pos = json.find(needle);
  if (key_pos == std::string::npos) {
    return fallback;
  }

  const std::size_t colon = json.find(':', key_pos + needle.size());
  if (colon == std::string::npos) {
    return fallback;
  }

  std::size_t value_pos = colon + 1;
  while (value_pos < json.size()) {
    const char c = json[value_pos];
    if ((c >= '0' && c <= '9') || c == '-' || c == '+') {
      break;
    }
    ++value_pos;
  }
  if (value_pos >= json.size()) {
    return fallback;
  }

  char* parse_end = nullptr;
  const double parsed = std::strtod(json.c_str() + value_pos, &parse_end);
  return parse_end == json.c_str() + value_pos ? fallback : parsed;
}

std::size_t find_object_end(const std::string& json, std::size_t object_start);

std::string extract_string_value(const std::string& json, const std::string& key, const std::string& fallback = "") {
  const std::string needle = "\"" + key + "\"";
  const std::size_t key_pos = json.find(needle);
  if (key_pos == std::string::npos) {
    return fallback;
  }
  const auto value = extract_string_value_at_key(json, key_pos, key);
  return value.empty() ? fallback : value;
}

bool extract_bool_value(const std::string& json, const std::string& key, bool fallback) {
  const std::string needle = "\"" + key + "\"";
  const std::size_t key_pos = json.find(needle);
  if (key_pos == std::string::npos) {
    return fallback;
  }
  const std::size_t colon = json.find(':', key_pos + needle.size());
  if (colon == std::string::npos) {
    return fallback;
  }
  std::size_t value_pos = colon + 1;
  while (value_pos < json.size() && std::isspace(static_cast<unsigned char>(json[value_pos]))) {
    ++value_pos;
  }
  if (json.compare(value_pos, 4, "true") == 0) {
    return true;
  }
  if (json.compare(value_pos, 5, "false") == 0) {
    return false;
  }
  return fallback;
}

std::string extract_object_json(const std::string& json, const std::string& key) {
  const std::string needle = "\"" + key + "\"";
  const std::size_t key_pos = json.find(needle);
  if (key_pos == std::string::npos) {
    return "";
  }
  const std::size_t colon = json.find(':', key_pos + needle.size());
  if (colon == std::string::npos) {
    return "";
  }
  const std::size_t object_start = json.find('{', colon + 1);
  if (object_start == std::string::npos) {
    return "";
  }
  const std::size_t object_end = find_object_end(json, object_start);
  if (object_end == std::string::npos) {
    return "";
  }
  return json.substr(object_start, object_end - object_start + 1);
}

Point3 extract_point3_value(const std::string& json, const std::string& key, Point3 fallback = {}) {
  const auto object_json = extract_object_json(json, key);
  if (object_json.empty()) {
    return fallback;
  }
  return {
      extract_number_value(object_json, "x", fallback.x),
      extract_number_value(object_json, "y", fallback.y),
      extract_number_value(object_json, "z", fallback.z),
  };
}

Point3 add_points(const Point3& a, const Point3& b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Point3 subtract_points(const Point3& a, const Point3& b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

double point_distance(const Point3& a, const Point3& b) {
  const auto delta = subtract_points(a, b);
  return std::sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
}

double extract_angle_radians(const std::string& json, const std::string& key, double fallback) {
  const auto angle_json = extract_object_json(json, key);
  if (angle_json.empty()) {
    const double degrees = extract_number_value(json, key, fallback);
    return degrees == fallback ? fallback : degrees * kPi / 180.0;
  }

  const double raw = extract_number_value(angle_json, "value", fallback);
  if (raw == fallback) {
    return fallback;
  }
  return extract_string_value(angle_json, "unit") == "radians" ? raw : raw * kPi / 180.0;
}

Point3 arc_point_at(const Point3& center, double radius, double angle, double z) {
  return {center.x + radius * std::cos(angle), center.y + radius * std::sin(angle), z};
}

void append_arc_sample_points(PathSummary& path, const PathSegmentSummary& segment) {
  const double span = segment.full_circle ? 2.0 * kPi : segment.end_angle - segment.start_angle;
  const int steps = std::max(8, static_cast<int>(std::ceil(std::abs(span) / (kPi / 24.0))));
  for (int step = 1; step <= steps; ++step) {
    const double t = static_cast<double>(step) / static_cast<double>(steps);
    const double angle = segment.start_angle + span * t;
    path.points.push_back(arc_point_at(segment.center, segment.radius, angle, segment.start.z));
  }
}

#if ZOO_OCCT_CORE_WITH_OCCT
Point3 scale_point(const Point3& point, double scale) {
  return {point.x * scale, point.y * scale, point.z * scale};
}

bool points_near(const Point3& a, const Point3& b) {
  return point_distance(a, b) < 1e-7;
}

Point3 cross(const Point3& a, const Point3& b) {
  return {
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x,
  };
}

Point3 local_to_world(const Point3& point, const std::string& plane_id) {
  const auto plane_it = state().planes.find(plane_id);
  if (plane_it == state().planes.end()) {
    return point;
  }
  const auto& plane = plane_it->second;
  return add_points(add_points(plane.origin, scale_point(plane.x_axis, point.x)), scale_point(plane.y_axis, point.y));
}

Point3 normal_for_plane(const std::string& plane_id) {
  const auto plane_it = state().planes.find(plane_id);
  if (plane_it == state().planes.end()) {
    return {0.0, 0.0, 1.0};
  }
  return cross(plane_it->second.x_axis, plane_it->second.y_axis);
}

Point3 x_axis_for_plane(const std::string& plane_id) {
  const auto plane_it = state().planes.find(plane_id);
  if (plane_it == state().planes.end()) {
    return {1.0, 0.0, 0.0};
  }
  return plane_it->second.x_axis;
}

gp_Pnt to_gp_point(const Point3& point) {
  return gp_Pnt(point.x, point.y, point.z);
}

gp_Dir to_gp_dir(const Point3& point, const Point3& fallback) {
  const Point3 value = point_distance(point, {0.0, 0.0, 0.0}) < 1e-9 ? fallback : point;
  return gp_Dir(value.x, value.y, value.z);
}
#endif

double polygon_area(const std::vector<Point3>& points) {
  if (points.size() < 3) {
    return 0.0;
  }
  double twice_area = 0.0;
  for (std::size_t i = 0; i < points.size(); ++i) {
    const auto& a = points[i];
    const auto& b = points[(i + 1) % points.size()];
    twice_area += a.x * b.y - b.x * a.y;
  }
  return std::abs(twice_area) / 2.0;
}

std::string target_id_for_command(const CommandBlock& command) {
  const auto target = extract_string_value(command.json, "target");
  return target.empty() ? extract_string_value(command.json, "object_id") : target;
}

std::size_t find_object_end(const std::string& json, std::size_t object_start) {
  int depth = 0;
  bool in_string = false;
  bool escaped = false;

  for (std::size_t pos = object_start; pos < json.size(); ++pos) {
    const char c = json[pos];
    if (in_string) {
      if (escaped) {
        escaped = false;
      } else if (c == '\\') {
        escaped = true;
      } else if (c == '"') {
        in_string = false;
      }
      continue;
    }

    if (c == '"') {
      in_string = true;
      continue;
    }
    if (c == '{') {
      ++depth;
    } else if (c == '}') {
      --depth;
      if (depth == 0) {
        return pos;
      }
    }
  }

  return std::string::npos;
}

std::size_t find_enclosing_object_start(const std::string& json, std::size_t member_pos) {
  std::size_t cursor = member_pos;
  while (cursor > 0) {
    const std::size_t object_start = json.rfind('{', cursor);
    if (object_start == std::string::npos) {
      return std::string::npos;
    }

    const std::size_t object_end = find_object_end(json, object_start);
    if (object_end != std::string::npos && object_start < member_pos && member_pos < object_end) {
      return object_start;
    }

    if (object_start == 0) {
      return std::string::npos;
    }
    cursor = object_start - 1;
  }

  return std::string::npos;
}

std::string extract_command_id_near(
    const std::string& request_json,
    std::size_t command_start,
    std::size_t command_end) {
  const std::string needle = "\"cmd_id\"";
  const std::size_t cmd_key_pos = request_json.rfind("\"cmd\"", command_start);
  if (cmd_key_pos != std::string::npos) {
    const std::size_t parent_start = request_json.rfind('{', cmd_key_pos);
    if (parent_start != std::string::npos) {
      const std::size_t parent_end = find_object_end(request_json, parent_start);
      if (parent_end != std::string::npos && command_end <= parent_end) {
        const std::size_t sibling_cmd_id_pos = request_json.find(needle, parent_start);
        if (sibling_cmd_id_pos != std::string::npos && sibling_cmd_id_pos < parent_end) {
          return extract_string_value_at_key(request_json, sibling_cmd_id_pos, "cmd_id");
        }
      }
    }
  }

  const std::size_t cmd_id_pos = request_json.rfind(needle, command_start);
  if (cmd_id_pos == std::string::npos) {
    const std::size_t next_cmd_id_pos = request_json.find(needle, command_end + 1);
    if (next_cmd_id_pos == std::string::npos) {
      return "";
    }
    return extract_string_value_at_key(request_json, next_cmd_id_pos, "cmd_id");
  }
  return extract_string_value_at_key(request_json, cmd_id_pos, "cmd_id");
}

bool is_core_command_type(const std::string& type) {
  return type == "scene_clear_all" || type == "make_plane" || type == "enable_sketch_mode" ||
         type == "sketch_mode_disable" || type == "start_path" || type == "move_path_pen" ||
         type == "extend_path" || type == "close_path" || type == "create_region" ||
         type == "create_region_from_query_point" || type == "extrude" || type == "revolve" || type == "sweep" || type == "loft" ||
         type == "boolean_union" || type == "boolean_subtract" || type == "boolean_intersection" ||
         type == "entity_linear_pattern_transform" || type == "entity_circular_pattern" ||
         type == "entity_make_helix" || type == "entity_make_helix_from_params" || type == "entity_make_helix_from_edge";
}

std::vector<CommandBlock> extract_command_blocks(const std::string& request_json) {
  std::vector<CommandBlock> commands;
  const std::string needle = "\"type\"";
  std::size_t pos = 0;
  std::size_t iterations = 0;

  while ((pos = request_json.find(needle, pos)) != std::string::npos) {
    if (++iterations > 1000) {
      break;
    }
    const std::string type = extract_string_value_at_key(request_json, pos, "type");
    if (!is_core_command_type(type)) {
      pos += needle.size();
      continue;
    }

    const std::size_t object_start = find_enclosing_object_start(request_json, pos);
    if (object_start == std::string::npos) {
      pos += needle.size();
      continue;
    }

    const std::size_t object_end = find_object_end(request_json, object_start);
    if (object_end == std::string::npos) {
      pos += needle.size();
      continue;
    }

    commands.push_back({
        extract_command_id_near(request_json, object_start, object_end),
        type,
        request_json.substr(object_start, object_end - object_start + 1),
        object_start,
    });
    pos = object_end + 1;
  }

  return commands;
}

void clear_geometry() {
  state().current_sketch_plane_id.clear();
  state().paths.clear();
  state().regions.clear();
  state().shapes.clear();
#if ZOO_OCCT_CORE_WITH_OCCT
  state().occt_shapes.clear();
#endif
}

void apply_make_plane(const CommandBlock& command) {
  state().planes[command.command_id] = {
      extract_point3_value(command.json, "origin"),
      extract_point3_value(command.json, "x_axis", {1.0, 0.0, 0.0}),
      extract_point3_value(command.json, "y_axis", {0.0, 1.0, 0.0}),
  };
}

void apply_start_path(const CommandBlock& command) {
  PathSummary path;
  path.plane_id = state().current_sketch_plane_id;
  state().paths[command.command_id] = path;
}

void apply_move_path_pen(const CommandBlock& command) {
  const auto path_id = extract_string_value(command.json, "path");
  auto path_it = state().paths.find(path_id);
  if (path_it == state().paths.end()) {
    return;
  }
  auto& path = path_it->second;
  path.pen = extract_point3_value(command.json, "to");
  path.start = path.pen;
  path.has_start = true;
  path.points.clear();
  path.segments.clear();
  path.points.push_back(path.start);
}

void apply_extend_path(const CommandBlock& command) {
  const auto path_id = extract_string_value(command.json, "path");
  auto path_it = state().paths.find(path_id);
  if (path_it == state().paths.end()) {
    return;
  }
  auto& path = path_it->second;
  const auto segment_json = extract_object_json(command.json, "segment");
  if (segment_json.empty()) {
    return;
  }
  const auto segment_type = extract_string_value(segment_json, "type");
  if (!path.has_start) {
    path.start = path.pen;
    path.has_start = true;
    path.points.push_back(path.start);
  }

  if (segment_type == "line") {
    Point3 end = extract_point3_value(segment_json, "end");
    if (extract_bool_value(segment_json, "relative", false)) {
      end = add_points(path.pen, end);
    }
    PathSegmentSummary segment;
    segment.type = "line";
    segment.start = path.pen;
    segment.end = end;
    path.segments.push_back(segment);
    path.pen = end;
    path.points.push_back(end);
    return;
  }

  if (segment_type == "arc") {
    Point3 center = extract_point3_value(segment_json, "center");
    const double radius = extract_number_value(segment_json, "radius", point_distance(path.pen, center));
    const double start_angle = extract_angle_radians(segment_json, "start", std::atan2(path.pen.y - center.y, path.pen.x - center.x));
    const double end_angle = extract_angle_radians(segment_json, "end", start_angle);
    const bool full_circle = std::abs(end_angle - start_angle) >= 2.0 * kPi - 1e-6;
    const Point3 start = arc_point_at(center, radius, start_angle, path.pen.z);
    const Point3 end = full_circle ? start : arc_point_at(center, radius, end_angle, path.pen.z);
    PathSegmentSummary segment{"arc", start, end, {center.x, center.y, path.pen.z}, radius, start_angle, end_angle, full_circle};
    path.segments.push_back(segment);
    append_arc_sample_points(path, segment);
    path.pen = end;
    return;
  }

  if (segment_type == "tangential_arc") {
    const double radius = extract_number_value(segment_json, "radius", 1.0);
    const double offset = extract_angle_radians(segment_json, "offset", 0.0);
    const bool ccw = offset > 0.0;
    double previous_tangent_angle = 0.0;
    if (!path.segments.empty()) {
      const auto& previous = path.segments.back();
      if (previous.type == "line") {
        previous_tangent_angle = std::atan2(previous.end.y - previous.start.y, previous.end.x - previous.start.x);
      } else if (previous.type == "arc") {
        previous_tangent_angle = previous.end_angle + (previous.end_angle > previous.start_angle ? kPi / 2.0 : -kPi / 2.0);
      }
    }
    const double start_angle = previous_tangent_angle + (ccw ? -kPi / 2.0 : kPi / 2.0);
    const double end_angle = start_angle + offset;
    const Point3 center = {
        -(radius * std::cos(start_angle) - path.pen.x),
        -(radius * std::sin(start_angle) - path.pen.y),
        path.pen.z,
    };
    const Point3 end = arc_point_at(center, radius, end_angle, path.pen.z);
    PathSegmentSummary segment{
        "arc",
        path.pen,
        end,
        center,
        radius,
        start_angle,
        end_angle,
        std::abs(end_angle - start_angle) >= 2.0 * kPi - 1e-6,
    };
    path.segments.push_back(segment);
    append_arc_sample_points(path, segment);
    path.pen = end;
  }
}

void apply_close_path(const CommandBlock& command) {
  const auto path_id = extract_string_value(command.json, "path_id");
  auto path_it = state().paths.find(path_id);
  if (path_it == state().paths.end()) {
    return;
  }
  path_it->second.closed = true;
}

void apply_create_region(const CommandBlock& command) {
  const auto path_id = target_id_for_command(command);
  auto path_it = state().paths.find(path_id);
  if (path_it == state().paths.end()) {
    return;
  }
  const auto& path = path_it->second;
  if (!path.closed || path.points.size() < 3) {
    return;
  }
  state().regions[command.command_id] = {path_id, path.plane_id, path.points, path.segments};
}

std::string shape_kind_for_command(const std::string& command_type, const std::string& body_type) {
  if (command_type == "extrude") {
    return body_type == "surface" ? "surface_extrude" : "extrude_prism";
  }
  if (command_type == "revolve") {
    return body_type == "surface" ? "surface_revolve" : "revolve_solid";
  }
  if (command_type == "sweep") {
    return body_type == "surface" ? "surface_sweep" : "sweep_solid";
  }
  if (command_type == "loft") {
    return body_type == "surface" ? "surface_loft" : "loft_solid";
  }
  if (command_type == "boolean_union" || command_type == "boolean_subtract" || command_type == "boolean_intersection") {
    return command_type;
  }
  if (command_type == "entity_linear_pattern_transform" || command_type == "entity_circular_pattern") {
    return "pattern_instance";
  }
  return "curve_or_surface";
}

double proxy_extent_for_command(const CommandBlock& command) {
  if (command.type == "extrude") {
    return extract_number_value(command.json, "distance", 1.0);
  }
  if (command.type == "revolve") {
    return std::max(std::abs(extract_number_value(command.json, "angle", 360.0)) / 360.0, 0.01);
  }
  return 1.0;
}

RegionSummary* region_for_command_target(const CommandBlock& command) {
  const auto target = target_id_for_command(command);
  auto region_it = state().regions.find(target);
  if (region_it != state().regions.end()) {
    return &region_it->second;
  }
  auto path_it = state().paths.find(target);
  if (path_it != state().paths.end() && path_it->second.closed && path_it->second.points.size() >= 3) {
    state().regions[target] = {target, path_it->second.plane_id, path_it->second.points, path_it->second.segments};
    return &state().regions[target];
  }
  return nullptr;
}

#if ZOO_OCCT_CORE_WITH_OCCT
TopoDS_Edge make_occt_edge(const PathSegmentSummary& segment, const std::string& plane_id) {
  if (segment.type == "line") {
    return BRepBuilderAPI_MakeEdge(to_gp_point(local_to_world(segment.start, plane_id)), to_gp_point(local_to_world(segment.end, plane_id))).Edge();
  }

  const auto center = local_to_world(segment.center, plane_id);
  Point3 normal = normal_for_plane(plane_id);
  const Point3 x_axis = x_axis_for_plane(plane_id);
  double start = segment.start_angle;
  double end = segment.end_angle;
  if (!segment.full_circle && end < start) {
    normal = scale_point(normal, -1.0);
    start = -start;
    end = -end;
  }

  const gp_Circ circle(gp_Ax2(to_gp_point(center), to_gp_dir(normal, {0.0, 0.0, 1.0}), to_gp_dir(x_axis, {1.0, 0.0, 0.0})), segment.radius);
  return segment.full_circle ? BRepBuilderAPI_MakeEdge(circle).Edge() : BRepBuilderAPI_MakeEdge(circle, start, end).Edge();
}

bool append_native_extrude_shape(const RegionSummary& region, double depth, double& volume) {
  if (!region.segments.empty()) {
    BRepBuilderAPI_MakeWire wire_builder;
    for (const auto& segment : region.segments) {
      wire_builder.Add(make_occt_edge(segment, region.plane_id));
    }

    const auto& first = region.segments.front().start;
    const auto& last = region.segments.back().end;
    if (!region.segments.front().full_circle && !points_near(first, last)) {
      wire_builder.Add(BRepBuilderAPI_MakeEdge(to_gp_point(local_to_world(last, region.plane_id)), to_gp_point(local_to_world(first, region.plane_id))).Edge());
    }

    if (!wire_builder.IsDone()) {
      return false;
    }

    BRepBuilderAPI_MakeFace face_builder(wire_builder.Wire(), true);
    if (!face_builder.IsDone()) {
      return false;
    }

    const auto normal = normal_for_plane(region.plane_id);
    const gp_Vec direction(normal.x * depth, normal.y * depth, normal.z * depth);
    TopoDS_Shape shape = BRepPrimAPI_MakePrism(face_builder.Face(), direction).Shape();
    GProp_GProps props;
    BRepGProp::VolumeProperties(shape, props);
    volume = props.Mass();
    state().occt_shapes.push_back(shape);
    return true;
  }

  BRepBuilderAPI_MakePolygon polygon;
  for (const auto& point : region.points) {
    const auto world = local_to_world(point, region.plane_id);
    polygon.Add(gp_Pnt(world.x, world.y, world.z));
  }
  polygon.Close();
  if (!polygon.IsDone()) {
    return false;
  }

  BRepBuilderAPI_MakeFace face_builder(polygon.Wire(), true);
  if (!face_builder.IsDone()) {
    return false;
  }

  const auto normal = normal_for_plane(region.plane_id);
  const gp_Vec direction(normal.x * depth, normal.y * depth, normal.z * depth);
  TopoDS_Shape shape = BRepPrimAPI_MakePrism(face_builder.Face(), direction).Shape();
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  volume = props.Mass();
  state().occt_shapes.push_back(shape);
  return true;
}
#endif

void append_shape_geometry(const CommandBlock& command) {
  const std::string body_type = extract_first_string_value(command.json, "body_type", "solid");
  const std::string kind = shape_kind_for_command(command.type, body_type);
  const double extent = proxy_extent_for_command(command);
  const double depth = extent == 0.0 ? 1.0 : std::abs(extent);
  double volume = body_type == "surface" ? 0.0 : depth;
  RegionSummary* region = region_for_command_target(command);
  if (region != nullptr) {
    volume = body_type == "surface" ? 0.0 : polygon_area(region->points) * depth;
  }

#if ZOO_OCCT_CORE_WITH_OCCT
  if (command.type == "extrude" && body_type != "surface" && region != nullptr &&
      append_native_extrude_shape(*region, extent == 0.0 ? 1.0 : extent, volume)) {
    // Real profile extrusion was appended by append_native_extrude_shape.
  } else if (body_type == "surface") {
    state().occt_shapes.push_back(BRepPrimAPI_MakeBox(1.0, 1.0, 0.001).Shape());
  } else {
    TopoDS_Shape shape = command.type == "revolve" ? BRepPrimAPI_MakeCylinder(0.5, depth).Shape()
                                                    : BRepPrimAPI_MakeBox(1.0, 1.0, depth).Shape();
    GProp_GProps props;
    BRepGProp::VolumeProperties(shape, props);
    volume = props.Mass();
    state().occt_shapes.push_back(shape);
  }
#endif

  state().shapes.push_back({command.command_id, kind, body_type, volume});
}

void apply_geometry_side_effects(const std::string& request_json) {
  const auto commands = extract_command_blocks(request_json);
  for (const auto& command : commands) {
    if (command.type == "scene_clear_all") {
      clear_geometry();
      continue;
    }
    if (command.type == "make_plane") {
      apply_make_plane(command);
      continue;
    }
    if (command.type == "enable_sketch_mode") {
      state().current_sketch_plane_id = extract_string_value(command.json, "entity_id");
      continue;
    }
    if (command.type == "sketch_mode_disable") {
      state().current_sketch_plane_id.clear();
      continue;
    }
    if (command.type == "start_path") {
      apply_start_path(command);
      continue;
    }
    if (command.type == "move_path_pen") {
      apply_move_path_pen(command);
      continue;
    }
    if (command.type == "extend_path") {
      apply_extend_path(command);
      continue;
    }
    if (command.type == "close_path") {
      apply_close_path(command);
      continue;
    }
    if (command.type == "create_region" || command.type == "create_region_from_query_point") {
      apply_create_region(command);
      continue;
    }
    append_shape_geometry(command);
  }
}

std::string geometry_state_json() {
  std::ostringstream out;
  out << "{"
      << "\"ok\":true,"
      << "\"engine\":\"open_cascade\","
      << "\"geometryBackend\":" << quoted(geometry_backend()) << ","
      << "\"nativeOcct\":" << (zoo_occt_core_has_native_occt() ? "true" : "false") << ","
      << "\"shapeCount\":" << state().shapes.size() << ","
      << "\"shapes\":[";
  for (std::size_t i = 0; i < state().shapes.size(); ++i) {
    if (i > 0) {
      out << ",";
    }
    out << "{"
        << "\"commandId\":" << quoted(state().shapes[i].command_id) << ","
        << "\"kind\":" << quoted(state().shapes[i].kind) << ","
        << "\"bodyType\":" << quoted(state().shapes[i].body_type) << ","
        << "\"volume\":" << state().shapes[i].volume
        << "}";
  }
  out << "]}";
  return out.str();
}

std::string ok_response(const std::string& request_id, const std::string& request_json) {
  const std::string kind = detect_request_kind(request_json);
  const std::string command_type = detect_command_type(request_json);
  const auto command_ids = extract_string_values(request_json, "cmd_id");
  apply_geometry_side_effects(request_json);

  std::ostringstream out;
  out << "{"
      << "\"ok\":true,"
      << "\"engine\":\"open_cascade\","
      << "\"geometryBackend\":" << quoted(geometry_backend()) << ","
      << "\"nativeOcct\":" << (zoo_occt_core_has_native_occt() ? "true" : "false") << ","
      << "\"shapeCount\":" << state().shapes.size() << ","
      << "\"requestId\":" << quoted(request_id) << ","
      << "\"response\":" << quoted(kind) << ","
      << "\"commandType\":" << quoted(command_type) << ","
      << "\"commandIds\":" << command_ids_json(command_ids)
      << "}";
  return out.str();
}

}  // namespace

const char* zoo_occt_core_version() {
  return "zoo-occt-command-core/0.1.0";
}

int zoo_occt_core_has_native_occt() {
#if ZOO_OCCT_CORE_WITH_OCCT
  return 1;
#else
  return 0;
#endif
}

char* zoo_occt_core_start_new_session() {
  clear_geometry();
  return copy_string("{\"ok\":true,\"engine\":\"open_cascade\",\"response\":\"new_session\"}");
}

char* zoo_occt_core_record_rollback_marker(const char* source_range_json) {
  std::ostringstream out;
  out << "{"
      << "\"ok\":true,"
      << "\"engine\":\"open_cascade\","
      << "\"response\":\"rollback_marker\","
      << "\"sourceRange\":" << quoted(as_string(source_range_json))
      << "}";
  return copy_string(out.str());
}

char* zoo_occt_core_handle_modeling_command(const char* request_id, const char* request_json) {
  return copy_string(ok_response(as_string(request_id), as_string(request_json)));
}

char* zoo_occt_core_debug_geometry_state() {
  return copy_string(geometry_state_json());
}

void zoo_occt_core_free(char* value) {
  std::free(value);
}
