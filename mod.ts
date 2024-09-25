import { exists } from "https://deno.land/std/fs/mod.ts";
import yargs from "https://deno.land/x/yargs/deno.ts";
import { Arguments } from "https://deno.land/x/yargs/deno-types.ts";
import os from "https://deno.land/x/dos@v0.11.0/mod.ts";
import { ensureDirSafe } from "https://gitlab.com/jackmac92/ensurePathExists/-/raw/master/mod.ts";

const homepath = Deno.env.get("HOME");
const encoder = new TextEncoder();
const encoded = (val: string) => encoder.encode(val);

const findBrowserConfigDir = async (browser: string) => {
  const osPlatform = os.platform();
  console.log(`Looking up dir for ${browser} on ${osPlatform}`);

  const orderedLocationsToCheck: string | undefined = {
    "linux chrome": [".config/google-chrome", ".config/google-chrome-beta"],
    "linux chromium": [".config/chromium"],
    "linux brave": [".config/BraveSoftware/Brave-Browser"],
    "linux vivaldi": [".config/vivaldi"],
    "darwin chrome": [
      "Library/Application Support/Google/Chrome",
      "Library/Application Support/Google/Chrome Beta",
    ],
    "darwin chromium": ["Library/Application Support/Chromium"],
    "darwin vivaldi": ["Library/Application Support/Vivaldi"],
  }[`${osPlatform} ${browser}`];

  if (!orderedLocationsToCheck) {
    throw new Error("Unknown browser/os combo");
  }

  for (const potentialLocation of orderedLocationsToCheck) {
    const p = `${homepath}/${potentialLocation}`;
    if (await exists(p)) {
      return p;
    }
  }
  throw new Error("Unable to locate chrome config dir");
};

const writeShellScript = async (
  targetPath: string,
  codeURI: string,
  denoFlags: string,
) => {
  const scriptContent = `#!/usr/bin/env bash\n/usr/bin/env deno run ${denoFlags} ${codeURI}`;

  const loadProc = new Deno.Command(Deno.execPath(), {
    args: ["cache", ...denoFlags.split(" ").filter(Boolean), codeURI],
  });
  await Deno.writeFile(targetPath, encoded(scriptContent));
  await Deno.chmod(targetPath, 0o777);
  await loadProc.output();
};

const scriptURItoConfigURI = (denoURI: string) =>
  `${denoURI.split("/").slice(0, -1).join("/")}/native-host-params.ts`;

yargs(Deno.args)
  .command(
    "install <denoURI>",
    "install a deno native messaging server",
    (yargs: any) => {
      yargs.positional("denoURI", {
        description: "The public url of the deno script to run",
      });
      yargs.option("autoConfig");
      yargs.describe(
        "autoConfig",
        "lookup config in `native-host-params.ts` sibling file of the main URI",
      );

      yargs.option("denoFlags");
      yargs.describe(
        "denoFlags",
        "flags to pass to deno when invoking the native host",
      );
      yargs.default("denoFlags", "");

      yargs.option("browser");
      yargs.describe(
        "browser",
        "the target browser for the native host extension",
      );
      yargs.default("browser", "chrome");

      yargs.option("resourceId");
      yargs.describe(
        "resourceId",
        "The resource id of the native messaging host",
      );

      yargs.option("description");

      yargs.array("allowedOrigins");

      return yargs;
    },
    async (argv: Arguments) => {
      const { denoURI, autoConfig, browser, denoFlags } = argv;
      console.log("Starting deno native host installation");
      const { resourceId, allowedOrigins, description } = await (async () => {
        if (!autoConfig) {
          return argv;
        }
        const configUrl = scriptURItoConfigURI(denoURI);
        const res = await import(configUrl);
        if (!res.denoFlags) {
          // insecure, but if you choose autoConfig give you a "just works" experience
          res.denoFlags = "-A --unstable";
        }
        return res;
      })();

      console.log("Generated config");
      const targetPathDir = `${homepath}/.local/var/deno-native-messaging`;
      await ensureDirSafe(targetPathDir);
      const targetPath = `${targetPathDir}/${resourceId}.sh`;
      await writeShellScript(targetPath, denoURI, denoFlags);

      const content = {
        name: resourceId,
        path: targetPath,
        description,
        allowed_origins: allowedOrigins,
        type: "stdio",
      };

      const chromeDir = await findBrowserConfigDir(browser);
      const nativeMessagingHostJsonPath = `${chromeDir}/NativeMessagingHosts/${resourceId}.json`;
      console.log("Writing file");
      Deno.writeFile(
        nativeMessagingHostJsonPath,
        encoded(JSON.stringify(content)),
      );
      console.log("Install success!");
    },
  )
  // .check( /* async */ (argv: Arguments) => {
  //   const { resourceId, autoConfig, denoURI, allowedOrigins, description } =
  //     argv;
  //   await import(denoURI);
  //   if (autoConfig) {
  //     await import(scriptURItoConfigURI(denoURI));
  //     // if the above resolves ignore remaining tests
  //     return;
  //   }
  //   allowedOrigins.forEach((o: string) => {
  //     if (!o.startsWith("chrome-extension://")) {
  //       throw new Error(
  //         "Invalid allowed origin, all must start with chrome-extension://"
  //       );
  //     }
  //   });
  //   if (resourceId.length === 0) {
  //     throw new Error("Provide a resourceId");
  //   }
  //   if (description.length === 0) {
  //     throw new Error("Provide a description");
  //   }
  //   console.log("Validated native host!");
  // })
  // @ts-expect-error `argv`
  .strictCommands().argv;
