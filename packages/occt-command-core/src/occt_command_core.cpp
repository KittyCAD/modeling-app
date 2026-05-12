#include "occt_command_core.h"

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>
#include <vector>

#if ZOO_OCCT_CORE_WITH_OCCT
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <GProp_GProps.hxx>
#include <TopoDS_Shape.hxx>
#endif

namespace {

struct ShapeSummary {
  std::string kind;
  double volume = 0.0;
};

struct CoreState {
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

std::vector<std::string> extract_string_values(const std::string& json, const std::string& key) {
  std::vector<std::string> values;
  const std::string needle = "\"" + key + "\"";
  std::size_t pos = 0;
  while ((pos = json.find(needle, pos)) != std::string::npos) {
    const std::size_t colon = json.find(':', pos + needle.size());
    if (colon == std::string::npos) {
      break;
    }
    const std::size_t open = json.find('"', colon + 1);
    if (open == std::string::npos) {
      break;
    }
    const std::size_t close = json.find('"', open + 1);
    if (close == std::string::npos) {
      break;
    }
    values.push_back(json.substr(open + 1, close - open - 1));
    pos = close + 1;
  }
  return values;
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

void clear_geometry() {
  state().shapes.clear();
#if ZOO_OCCT_CORE_WITH_OCCT
  state().occt_shapes.clear();
#endif
}

void append_extrude_geometry(const std::string& request_json) {
  const double distance = extract_number_value(request_json, "distance", 1.0);
  const double depth = distance == 0.0 ? 1.0 : std::abs(distance);
  double volume = depth;

#if ZOO_OCCT_CORE_WITH_OCCT
  TopoDS_Shape shape = BRepPrimAPI_MakeBox(1.0, 1.0, depth).Shape();
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  volume = props.Mass();
  state().occt_shapes.push_back(shape);
#endif

  state().shapes.push_back({"extrude_prism", volume});
}

void apply_geometry_side_effects(const std::string& request_json) {
  if (request_json.find("\"type\":\"scene_clear_all\"") != std::string::npos) {
    clear_geometry();
  }
  if (request_json.find("\"type\":\"extrude\"") != std::string::npos) {
    append_extrude_geometry(request_json);
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
        << "\"kind\":" << quoted(state().shapes[i].kind) << ","
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
