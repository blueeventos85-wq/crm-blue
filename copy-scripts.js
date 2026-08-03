import fs from 'fs';
import path from 'path';

const filesToCopy = ['app.js', 'supabaseClient.js'];
const distDir = './dist';

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

filesToCopy.forEach(file => {
  const src = path.join(process.cwd(), file);
  const dest = path.join(process.cwd(), distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[Copy Script] Copied ${file} to ${dest}`);
  } else {
    console.warn(`[Copy Script] Warning: File ${file} not found at ${src}`);
  }
});
