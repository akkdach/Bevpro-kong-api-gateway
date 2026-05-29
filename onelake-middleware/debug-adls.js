const { DataLakeServiceClient } = require("@azure/storage-file-datalake");
const { DefaultAzureCredential, InteractiveBrowserCredential } = require("@azure/identity");
require('dotenv').config();

const accountName = "onelake";
const accountUrl = `https://${accountName}.dfs.fabric.microsoft.com`;

async function getCredential() {
    try {
        const cred = new DefaultAzureCredential();
        await cred.getToken("https://storage.azure.com/.default");
        return cred;
    } catch (e) {
        console.log("Interactive Login Required...");
        return new InteractiveBrowserCredential();
    }
}

async function main() {
    const credential = await getCredential();
    const serviceClient = new DataLakeServiceClient(accountUrl, credential);

    // Extract Workspace GUID from Server URL
    // Server: zf7yrpjhd77uxedw7r2suvgpv4-qqvsu63hb4pu3du7mwv7vccqdu.datawarehouse.fabric.microsoft.com
    const serverUri = process.env.DB_SERVER || "";
    const workspaceId = serverUri.split(".")[0];

    console.log(`Potential Workspace ID: ${workspaceId}`);

    const candidates = [
        workspaceId, // Try GUID
        'dataverse_bevproasia_cds2_workspace_unq520782ff3395f011a701000d3aa2b', // Hardcoded guess
        process.env.DB_DATABASE
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        console.log(`\nChecking Filesystem: ${candidate} ...`);
        const fsClient = serviceClient.getFileSystemClient(candidate);

        try {
            // Check if exists by listing root
            const paths = fsClient.listPaths({ maxResults: 5, recursive: true });
            let exists = false;
            for await (const path of paths) {
                console.log(`   - Found item: ${path.name}`);
                exists = true;
                if (path.name.includes("smaserviceordertable") && path.name.endsWith(".parquet")) {
                    console.log(`   ✅ MATCH FOUND at: ${candidate}/${path.name}`);
                    console.log(`   Full URL: ${fsClient.url}/${path.name}`);
                    return; // Stop on first match
                }
            }
            if (exists) console.log("   (Filesystem exists but specific table not found in top 5 items)");
        } catch (e) {
            if (e.statusCode === 404) console.log("   (Not Found)");
            else if (e.statusCode === 403) console.log("   (Access Denied)");
            else console.log(`   Error: ${e.message}`);
        }
    }
}

main();
