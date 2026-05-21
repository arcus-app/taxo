import { appendFileSync } from "node:fs";

export function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  } else {
    console.log(`::set-output name=${key}::${value}`);
  }
}
