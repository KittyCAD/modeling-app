const fs = require("fs");
const path = require("path");

const FILE_EXTENSION = ".kcl";
const MANIFEST_FILE = "manifest.json";
const COMMENT_PREFIX = "//";

// Function to read and parse .kcl files
const getKclMetadata = (projectPath, files) => {
  const primaryKclFile = files.find((file) => file.includes("main.kcl")) ?? files.sort()[0];
  const fullPathToPrimaryKcl = path.join(projectPath, primaryKclFile);

  const content = fs.readFileSync(fullPathToPrimaryKcl, "utf-8");
  const lines = content.split("\n");

  if (lines.length < 2) {
    return null;
  }

  const title = lines[0].replace(COMMENT_PREFIX, "").trim();
  const description = lines[1].replace(COMMENT_PREFIX, "").trim();

  return {
    file: primaryKclFile,
    // Assumed to ALWAYS be 1 level deep. That's the current practice.
    pathFromProjectDirectoryToFirstFile: fullPathToPrimaryKcl.split('/').splice(-2).join('/'),
    // This was added so that multiple file project samples do not load in
    // the web app through the manifest.
    multipleFiles: files.length > 1,
    title,
    description,
  };
};

// Function to scan the directory and generate the manifest.json
const generateManifest = (dir) => {
  const projectDirectories = fs.readdirSync(dir);
  const manifest = [];

  projectDirectories.forEach((file) => {
    const projectPath = path.join(dir, file);
    const stattedDir = fs.statSync(projectPath);
    if (stattedDir.isDirectory()) {
      const files = fs
        .readdirSync(projectPath)
        .filter((f) => f.endsWith(FILE_EXTENSION));
      if (files.length === 0) {
        return;
      }
      const metadata = getKclMetadata(projectPath, files);
      if (metadata) {
        manifest.push(metadata);
      }
    }
  });

  // Write the manifest.json
  const outputPath = path.join(dir, MANIFEST_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest of ${manifest.length} items written to ${outputPath}`);
};

// Run the script
console.log(`Generating ${MANIFEST_FILE}...`);
const projectDir = path.resolve(__dirname); // Set project root directory
generateManifest(projectDir);
