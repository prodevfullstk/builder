import JSZip from 'jszip';

/**
 * Export all files from virtual file system into a zip archive and trigger browser download
 */
export async function downloadProjectAsZip(files: Record<string, string>, projectName: string = 'opendork-project') {
  const zip = new JSZip();

  // Add all files into the zip archive
  for (const [path, content] of Object.entries(files)) {
    // Strip leading slashes
    const cleanPath = path.replace(/^\/+/, '');
    zip.file(cleanPath, content);
  }

  // Generate binary zip
  const blob = await zip.generateAsync({ type: 'blob' });

  // Create temporary URL and anchor to trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
