const png2icons = require('png2icons');
const fs = require('fs');

const input = fs.readFileSync('icon.png');
const output = png2icons.createICO(input, png2icons.BICUBIC, 0, true, true);
if (output) {
  fs.writeFileSync('icon.ico', output);
  console.log('✅ icon.ico created successfully!');
} else {
  console.log('❌ Failed - make sure icon.png exists and is at least 256x256');
}