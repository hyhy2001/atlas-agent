import { createInterface } from "node:readline";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import chalk from "chalk";
import { paths } from "./paths.js";

export interface Credentials {
  baseURL: string;
  authToken: string;
}

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function interactiveLogin(): Promise<Credentials | null> {
  console.clear();
  console.log(chalk.bold.cyan("╔══════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("║        Welcome to atlas-agent        ║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════════════╝"));
  console.log("");
  console.log("How would you like to connect?\n");
  console.log(chalk.bold("  1. API Key + Base URL") + chalk.gray("  (OpenAI-compatible: 9router, Databricks, Azure...)"));
  console.log(chalk.gray("  2. [Coming soon] OAuth"));
  console.log(chalk.gray("  3. [Coming soon] Enterprise SSO"));
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const choice = await prompt(rl, chalk.cyan("Select [1]: "));
    if (choice !== "" && choice !== "1") {
      console.log(chalk.yellow("\nOnly option 1 is available. Please select 1 or press Enter."));
      rl.close();
      return interactiveLogin();
    }

    console.log("");
    const baseURL = await prompt(rl, chalk.white("Base URL ") + chalk.gray("(e.g. http://proxy:port/v1): "));
    if (!baseURL) {
      console.log(chalk.red("Base URL is required."));
      rl.close();
      return null;
    }

    const authToken = await prompt(rl, chalk.white("API Key: "));
    if (!authToken) {
      console.log(chalk.red("API Key is required."));
      rl.close();
      return null;
    }

    console.log("");
    const save = await prompt(rl, chalk.white("Save to .atlas/settings.json?") + chalk.gray(" [Y/n]: "));
    rl.close();

    if (save.toLowerCase() !== "n") {
      saveCredentials({ baseURL, authToken });
      console.log(chalk.green("✓ Credentials saved to .atlas/settings.json"));
    }

    console.log("");
    return { baseURL, authToken };
  } catch (err) {
    rl.close();
    return null;
  }
}

function saveCredentials(creds: Credentials): void {
  const configPath = paths.config();
  mkdirSync(dirname(configPath), { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {}
  }

  existing.baseURL = creds.baseURL;
  existing.authToken = creds.authToken;

  writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
}

export function hasCredentials(): boolean {
  if (process.env["ATLAS_AUTH_TOKEN"]) return true;
  const configPath = paths.config();
  if (!existsSync(configPath)) return false;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return !!(config.authToken || config.apiKey);
  } catch {
    return false;
  }
}
