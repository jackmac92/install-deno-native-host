import { exists, ensureDir } from "https://deno.land/std@0.99.0/fs/mod.ts";
import yargs from "https://deno.land/x/yargs/deno.ts";
import { Arguments } from "https://deno.land/x/yargs/deno-types.ts";
import os from "https://deno.land/x/dos@v0.11.0/mod.ts";

const homepath = Deno.env.get("HOME");
const encoder = new TextEncoder();
const encoded = (val: string) => encoder.encode(val);

const findBrowserConfigDir = async (browser: string) => {
    const osPlatform = os.platform();
    console.log(`Looking up dir for ${browser} on ${osPlatform}`);
    const orderedLocationsToCheck = {
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
        throw new Error("Unknown browser/os combo")
    }

    for (const potentialLocation of orderedLocationsToCheck) {
        const p = `${homepath}/${potentialLocation}`;
        if (await exists(p)) {
            return p;
        }
    }
    throw new Error("Unable to locate chrome config dir");
};

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
    /// interesting idea below but just passing a string seems more straightforward
    // const flags = denoFlags.map((f) => `--${f}`).join(" ");
    const scriptContent = `#!/usr/bin/env bash\n${denoCmd} run ${denoFlags} ${codeURI}`;

    await Deno.writeFile(targetPath, encoded(scriptContent));
    await Deno.chmod(targetPath, 0o777);
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
                "lookup config in `native-host-params.ts` sibling file of the main URI"
            );

            yargs.option("denoFlags");
            yargs.describe(
                "denoFlags",
                "flags to pass to deno when invoking the native host"
            );

            yargs.option("browser");
            yargs.describe(
                "browser",
                "the target browser for the native host extension"
            );
            yargs.default("browser", "chrome");

            yargs.option("resourceId");
            yargs.describe(
                "resourceId",
                "The resource id of the native messaging host"
            );

            yargs.option("description");

            yargs.array("allowedOrigins");

            return yargs;
        },
        async (argv: Arguments) => {
            const { denoURI, autoConfig, browser, denoFlags } = argv;
            console.log("Starting deno native host installation");
            const { resourceId, allowedOrigins, description } =
                await (async () => {
                    if (!autoConfig) {
                        return argv;
                    }
                    const configUrl = scriptURItoConfigURI(denoURI);
                    const res = await import(configUrl);
                    return res;
                })();

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
            Deno.writeFile(
                nativeMessagingHostJsonPath,
                encoded(JSON.stringify(content))
            );
            console.log("Install success!");
        }
    )
    // @ts-expect-error
    .strictCommands().argv;
