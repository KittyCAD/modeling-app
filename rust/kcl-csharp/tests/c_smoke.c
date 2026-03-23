#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct SessionHandle SessionHandle;

typedef enum FileExportFormat {
    FileExportFormat_Fbx,
    FileExportFormat_Glb,
    FileExportFormat_Gltf,
    FileExportFormat_Obj,
    FileExportFormat_Ply,
    FileExportFormat_Step,
    FileExportFormat_Stl,
} FileExportFormat;

typedef struct ExportedFile {
    char *name;
    uint8_t *contents;
    size_t contents_len;
} ExportedFile;

typedef struct ExportResult {
    bool kcl_error_set;
    char *kcl_error;
    bool setup_error_set;
    char *setup_error;
    ExportedFile *exports;
    size_t exports_len;
} ExportResult;

typedef struct SessionStartResult {
    SessionHandle *session;
    bool setup_error_set;
    char *setup_error;
} SessionStartResult;

extern SessionStartResult start_session(const char *auth_token);
extern ExportResult session_run_contents_and_export(
    SessionHandle *session,
    const char *contents,
    const char *current_file,
    FileExportFormat export_format
);
extern void free_session_start_result(SessionStartResult result);
extern void free_export_result(ExportResult result);
extern void free_session(SessionHandle *session);

static const char *FIRST_PROGRAM =
    "part001 = startSketchOn(XY)\n"
    "  |> startProfile(at = [5.5229, 5.25217])\n"
    "  |> line(end = [10.50433, -1.19122])\n"
    "  |> line(end = [8.01362, -5.48731])\n"
    "  |> line(end = [-1.02877, -6.76825])\n"
    "  |> line(end = [-11.53311, 2.81559])\n"
    "  |> close()\n"
    "  |> extrude(length = 4)\n";

static const char *SECOND_PROGRAM =
    "part001 = startSketchOn(XY)\n"
    "  |> startProfile(at = [0, 0])\n"
    "  |> line(end = [10, 0])\n"
    "  |> line(end = [0, 10])\n"
    "  |> line(end = [-10, 0])\n"
    "  |> close()\n"
    "  |> extrude(length = 8)\n";

static size_t total_export_bytes(const ExportResult *result) {
    size_t total = 0;
    size_t i;

    for (i = 0; i < result->exports_len; ++i) {
        total += result->exports[i].contents_len;
    }

    return total;
}

static int check_export_result(const char *label, const ExportResult *result) {
    if (result->setup_error_set) {
        fprintf(stderr, "%s setup error: %s\n", label, result->setup_error);
        return 0;
    }

    if (result->kcl_error_set) {
        fprintf(stderr, "%s KCL error: %s\n", label, result->kcl_error);
        return 0;
    }

    if (result->exports == NULL || result->exports_len == 0) {
        fprintf(stderr, "%s returned no exports\n", label);
        return 0;
    }

    return 1;
}

int main(void) {
    const char *auth_token = getenv("ZOO_API_TOKEN");
    SessionStartResult session_start = start_session(auth_token);
    SessionHandle *session = NULL;
    ExportResult first_export;
    ExportResult second_export;
    size_t first_total_bytes;
    size_t second_total_bytes;
    int ok = 1;

    if (session_start.setup_error_set) {
        fprintf(stderr, "start_session failed: %s\n", session_start.setup_error);
        free_session_start_result(session_start);

        if (auth_token == NULL || auth_token[0] == '\0') {
            fprintf(stderr, "Skipping live smoke test because ZOO_API_TOKEN is not set.\n");
            return 0;
        }

        return 1;
    }

    session = session_start.session;
    free_session_start_result(session_start);

    first_export = session_run_contents_and_export(
        session,
        FIRST_PROGRAM,
        NULL,
        FileExportFormat_Gltf
    );
    ok = check_export_result("first run", &first_export);
    first_total_bytes = total_export_bytes(&first_export);

    second_export = session_run_contents_and_export(
        session,
        SECOND_PROGRAM,
        NULL,
        FileExportFormat_Gltf
    );
    ok = ok && check_export_result("second run", &second_export);
    second_total_bytes = total_export_bytes(&second_export);

    if (ok && first_total_bytes == 0) {
        fprintf(stderr, "first run exported zero bytes\n");
        ok = 0;
    }

    if (ok && second_total_bytes == 0) {
        fprintf(stderr, "second run exported zero bytes\n");
        ok = 0;
    }

    if (ok && first_total_bytes == second_total_bytes) {
        fprintf(stderr, "warning: both runs exported the same total byte count; geometry may still differ\n");
    }

    free_export_result(first_export);
    free_export_result(second_export);
    free_session(session);

    if (!ok) {
        return 1;
    }

    printf("C smoke test completed successfully.\n");
    return 0;
}
