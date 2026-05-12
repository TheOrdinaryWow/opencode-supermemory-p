import * as readline from "node:readline";

export function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export async function confirm(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(`${question} (y/n) `, (answer) => {
      const lower = answer.toLowerCase();
      resolve(lower === "y" || lower === "yes");
    });
  });
}
