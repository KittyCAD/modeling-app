use std::fs;

use zed::settings::LspSettings;
use zed_extension_api as zed;

const SERVER_NAME: &str = "kcl-language-server";
const RELEASE_REPOSITORY: &str = "KittyCAD/modeling-app";
const RELEASES_URL: &str = "https://api.github.com/repos/KittyCAD/modeling-app/releases?per_page=100";

struct ServerRelease {
    version: String,
    download_url: String,
}

struct KclExtension {
    cached_binary_path: Option<String>,
}

impl KclExtension {
    fn server_binary_path(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<String> {
        if let Some(path) = worktree.which(SERVER_NAME) {
            return Ok(path);
        }

        if let Some(path) = self
            .cached_binary_path
            .as_ref()
            .filter(|path| fs::metadata(path).is_ok_and(|metadata| metadata.is_file()))
        {
            return Ok(path.clone());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let (os, architecture) = zed::current_platform();
        let target = server_target(os, architecture)?;
        let archive_name = server_archive_name(target, os);
        let release = latest_server_release(&archive_name)?;

        let version_dir = format!("{SERVER_NAME}-{}", release.version);
        let executable_name = if os == zed::Os::Windows {
            format!("{SERVER_NAME}.exe")
        } else {
            SERVER_NAME.to_string()
        };
        let binary_path = format!("{version_dir}/{executable_name}");

        if !fs::metadata(&binary_path).is_ok_and(|metadata| metadata.is_file()) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            fs::create_dir_all(&version_dir).map_err(|error| format!("failed to create {version_dir}: {error}"))?;

            if os == zed::Os::Windows {
                zed::download_file(&release.download_url, &version_dir, zed::DownloadedFileType::Zip)?;
            } else {
                zed::download_file(&release.download_url, &binary_path, zed::DownloadedFileType::Gzip)?;
                zed::make_file_executable(&binary_path)?;
            }

            remove_old_server_versions(&version_dir);
        }

        self.cached_binary_path = Some(binary_path.clone());
        Ok(binary_path)
    }
}

impl zed::Extension for KclExtension {
    fn new() -> Self {
        Self {
            cached_binary_path: None,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)?;
        let binary_settings = settings.binary.unwrap_or(zed::settings::CommandSettings {
            path: None,
            arguments: None,
            env: None,
        });

        let command = match binary_settings.path {
            Some(path) => path,
            None => self.server_binary_path(language_server_id, worktree)?,
        };
        let args = binary_settings
            .arguments
            .unwrap_or_else(|| vec!["server".to_string(), "--stdio".to_string()]);
        let mut env: Vec<_> = binary_settings.env.unwrap_or_default().into_iter().collect();
        env.sort_unstable_by(|left, right| left.0.cmp(&right.0));

        Ok(zed::Command { command, args, env })
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<zed::serde_json::Value>> {
        Ok(LspSettings::for_worktree(language_server_id.as_ref(), worktree)?.initialization_options)
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<zed::serde_json::Value>> {
        Ok(LspSettings::for_worktree(language_server_id.as_ref(), worktree)?.settings)
    }
}

fn server_target(os: zed::Os, architecture: zed::Architecture) -> zed::Result<&'static str> {
    match (os, architecture) {
        (zed::Os::Mac, zed::Architecture::Aarch64) => Ok("aarch64-apple-darwin"),
        (zed::Os::Linux, zed::Architecture::Aarch64) => Ok("aarch64-unknown-linux-gnu"),
        (zed::Os::Linux, zed::Architecture::X8664) => Ok("x86_64-unknown-linux-gnu"),
        (zed::Os::Windows, zed::Architecture::X8664) => Ok("x86_64-pc-windows-msvc"),
        _ => Err(format!(
            "Zoo does not publish a language server for {os:?}/{architecture:?}; install \
             {SERVER_NAME} on PATH or configure lsp.{SERVER_NAME}.binary.path"
        )),
    }
}

fn server_archive_name(target: &str, os: zed::Os) -> String {
    let extension = if os == zed::Os::Windows { "zip" } else { "gz" };
    format!("{SERVER_NAME}-{target}.{extension}")
}

fn latest_server_release(archive_name: &str) -> zed::Result<ServerRelease> {
    let request = zed::http_client::HttpRequest::builder()
        .method(zed::http_client::HttpMethod::Get)
        .url(RELEASES_URL)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "zoo-kcl-zed")
        .build()?;
    let response = request.fetch()?;
    let releases: zed::serde_json::Value = zed::serde_json::from_slice(&response.body)
        .map_err(|error| format!("failed to parse releases from {RELEASE_REPOSITORY}: {error}"))?;

    select_server_release(&releases, archive_name).ok_or_else(|| {
        format!(
            "the newest 100 releases from {RELEASE_REPOSITORY} contain no stable kcl-* release with asset {archive_name}"
        )
    })
}

fn select_server_release(releases: &zed::serde_json::Value, archive_name: &str) -> Option<ServerRelease> {
    releases.as_array()?.iter().find_map(|release| {
        let version = release.get("tag_name")?.as_str()?;
        if !version.starts_with("kcl-")
            || release.get("draft").and_then(|value| value.as_bool()) == Some(true)
            || release.get("prerelease").and_then(|value| value.as_bool()) == Some(true)
        {
            return None;
        }

        let asset = release
            .get("assets")?
            .as_array()?
            .iter()
            .find(|asset| asset.get("name").and_then(|name| name.as_str()) == Some(archive_name))?;
        Some(ServerRelease {
            version: version.to_string(),
            download_url: asset.get("browser_download_url")?.as_str()?.to_string(),
        })
    })
}

fn remove_old_server_versions(current_version_dir: &str) {
    let Ok(entries) = fs::read_dir(".") else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name != current_version_dir && name.starts_with(&format!("{SERVER_NAME}-kcl-")) && path.is_dir() {
            let _ = fs::remove_dir_all(path);
        }
    }
}

zed::register_extension!(KclExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_published_server_targets() {
        assert_eq!(
            server_target(zed::Os::Mac, zed::Architecture::Aarch64).unwrap(),
            "aarch64-apple-darwin"
        );
        assert_eq!(
            server_target(zed::Os::Linux, zed::Architecture::X8664).unwrap(),
            "x86_64-unknown-linux-gnu"
        );
        assert_eq!(
            server_target(zed::Os::Windows, zed::Architecture::X8664).unwrap(),
            "x86_64-pc-windows-msvc"
        );
    }

    #[test]
    fn uses_release_archive_format_for_each_os() {
        assert_eq!(
            server_archive_name("aarch64-apple-darwin", zed::Os::Mac),
            "kcl-language-server-aarch64-apple-darwin.gz"
        );
        assert_eq!(
            server_archive_name("x86_64-pc-windows-msvc", zed::Os::Windows),
            "kcl-language-server-x86_64-pc-windows-msvc.zip"
        );
    }

    #[test]
    fn skips_app_releases_when_selecting_the_server() {
        let releases = zed::serde_json::json!([
            {
                "tag_name": "v1.4.4",
                "draft": false,
                "prerelease": false,
                "assets": [{
                    "name": "modeling-app.dmg",
                    "browser_download_url": "https://example.com/modeling-app.dmg"
                }]
            },
            {
                "tag_name": "kcl-179",
                "draft": false,
                "prerelease": false,
                "assets": [{
                    "name": "kcl-language-server-aarch64-apple-darwin.gz",
                    "browser_download_url": "https://example.com/kcl-language-server.gz"
                }]
            }
        ]);

        let release = select_server_release(&releases, "kcl-language-server-aarch64-apple-darwin.gz").unwrap();
        assert_eq!(release.version, "kcl-179");
        assert_eq!(release.download_url, "https://example.com/kcl-language-server.gz");
    }
}
