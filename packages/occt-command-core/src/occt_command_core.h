#pragma once

#ifdef __cplusplus
extern "C" {
#endif

const char* zoo_occt_core_version();
int zoo_occt_core_has_native_occt();
char* zoo_occt_core_start_new_session();
char* zoo_occt_core_record_rollback_marker(const char* source_range_json);
char* zoo_occt_core_handle_modeling_command(const char* request_id, const char* request_json);
char* zoo_occt_core_debug_geometry_state();
void zoo_occt_core_free(char* value);

#ifdef __cplusplus
}
#endif
