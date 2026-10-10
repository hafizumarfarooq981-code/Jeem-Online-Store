const fs = require('fs');
const path = require('path');

console.log('=== [JEEM ONLINE STORE VERCEL PACKAGER] ===');

const distDir = path.join(__dirname, 'dist');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

// 1. Copy client/dist (if present) to root dist/ and public/
const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist) && fs.existsSync(path.join(clientDist, 'index.html'))) {
  fs.cpSync(clientDist, distDir, { recursive: true });
  fs.cpSync(clientDist, publicDir, { recursive: true });
  console.log('✔ Client frontend copied to dist/ and public/');
} else if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  fs.cpSync(publicDir, distDir, { recursive: true });
  console.log('✔ Prebuilt public/ copied to dist/');
}

// 2. Copy uploads/JEEM-Store.apk to dist/uploads/ and public/uploads/
const apkSrc = path.join(__dirname, 'uploads', 'JEEM-Store.apk');
if (fs.existsSync(apkSrc)) {
  const distUploads = path.join(distDir, 'uploads');
  const publicUploads = path.join(publicDir, 'uploads');
  if (!fs.existsSync(distUploads)) fs.mkdirSync(distUploads, { recursive: true });
  if (!fs.existsSync(publicUploads)) fs.mkdirSync(publicUploads, { recursive: true });
  fs.copyFileSync(apkSrc, path.join(distUploads, 'JEEM-Store.apk'));
  fs.copyFileSync(apkSrc, path.join(publicUploads, 'JEEM-Store.apk'));
  console.log('✔ JEEM-Store.apk copied to dist/uploads/ and public/uploads/');
}

console.log('=== [PACKAGING COMPLETED SUCCESSFULLY] ===');
