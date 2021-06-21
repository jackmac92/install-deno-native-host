import { exists, ensureDir } from "https://deno.land/std@0.99.0/fs/mod.ts";
import yargs from "https://deno.land/x/yargs/deno.ts";
import { Arguments } from "https://deno.land/x/yargs/deno-types.ts";

const homepath = Deno.env.get("HOME");

const findBrowserConfigDir = async () => {
  const orderedLocationsToCheck = [
    ".config/google-chrome",
    ".config/google-chrome-beta",
    "Library/Application Support/Google/Chrome",
  ];

  for (let potentialLocation of orderedLocationsToCheck) {
    const p = `${homepath}/${potentialLocation}`;
    if (await exists(p)) {
      return p;
    }
  }
  throw new Error("Unable to locate chrome config dir");
};

const encoded = new TextEncoder().encode;

const ensureDirSafe = async (path: string) => {
  const components = path.split("/");

  const [_, pathAncestors] = Array(components.length).reduce(
    (acc, el) => {
      const [pathComponents, result] = acc;
      const nextPathComponents = [...pathComponents];
      const nextComponent = nextPathComponents.join("/");
      nextPathComponents.pop();
      if (nextComponent === homepath) {
        return acc;
      }
      return [nextPathComponents, [nextComponent, ...result]];
    },
    [components, []]
  );
  for (let ancestor of pathAncestors) {
    await ensureDir(ancestor);
  }
};

const writeShellScript = async (
  targetPath: string,
  codeURI: string,
  denoFlags = []
) => {
  const denoCmd = Deno.execPath();
  const flags = denoFlags.map((f) => `--${f}`).join(" ");
  const scriptContent = `
#!/usr/bin/env bash
set -euo pipefail

${denoCmd} run ${flags} ${codeURI}`;

  await Deno.writeFile(targetPath, encoded(scriptContent));
  await Deno.chmod(targetPath, 0o664);
};

yargs(Deno.args)
  .command(
    "install",
    "install a deno native messaging server",
    (yargs: any) => {
      yargs.option("resourceId");
      yargs.demandOption("resourceId");
      yargs.describe("The resource id of the native messaging host");
      yargs.option("denoURI");
      yargs.demandOption("denoURI");
      yargs.describe("denoURI", "The public url of the deno script to run");
      yargs.option("description");
      yargs.demandOption("description");
      yargs.array("allowedOrigins");
      yargs.demandOption("allowedOrigins");
      return yargs;
    },
    async (argv: Arguments) => {
      const chromeDir = await findBrowserConfigDir();
      const { resourceId, denoURI, allowedOrigins, description } = argv;

      const targetPathDir = `${homepath}/.local/var/deno-native-messaging`;
      await ensureDirSafe(targetPathDir);
      const targetPath = `${targetPathDir}/${resourceId}.sh`;
      await writeShellScript(targetPath, denoURI);

      const content = {
        name: resourceId,
        path: targetPath,
        description,
        allowed_origins: allowedOrigins,
        type: "stdio",
      };

      const nativeMessagingHostJsonPath = `${chromeDir}/NativeMessagingHosts/${resourceId}.json`;
      Deno.writeFile(
        nativeMessagingHostJsonPath,
        encoded(JSON.stringify(content))
      );
    }
  )
  .check(async (argv: Arguments) => {
    const { resourceId, denoURI, allowedOrigins, description } = argv;
    const res = await fetch(denoURI);
    allowedOrigins.forEach((o: string) => {
      if (!o.startsWith("chrome-extension://")) {
        throw new Error(
          "Invalid allowed origin, all must start with chrome-extension://"
        );
      }
    });
    if (resourceId.length === 0) {
      throw new Error("Provide a resourceId");
    }
    if (description.length === 0) {
      throw new Error("Provide a description");
    }
  })
  .strictCommands()
  .demandCommand(1).argv;
