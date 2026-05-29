/**
 * SharePoint Service - Microsoft Graph API integration
 * Reads Excel files from SharePoint using Azure AD authentication
 */

require('isomorphic-fetch');
const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const { logToFile } = require('../utils/logger');

// SharePoint configuration
const SHAREPOINT_CONFIG = {
    siteHost: 'bevproasia2016.sharepoint.com',
    sitePath: '', // Root site
    fileName: 'Record_Monthly.xlsx',
    sheetName: 'Sheet1', // Default sheet, can be changed
};

let graphClient = null;

/**
 * Initialize Microsoft Graph client with Azure AD credentials
 */
function getGraphClient() {
    if (graphClient) return graphClient;

    const credential = new ClientSecretCredential(
        process.env.AZURE_TENANT_ID,
        process.env.AZURE_CLIENT_ID,
        process.env.AZURE_CLIENT_SECRET
    );

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
        scopes: ['https://graph.microsoft.com/.default'],
    });

    graphClient = Client.initWithMiddleware({ authProvider });
    logToFile('[SharePoint] Graph client initialized');
    return graphClient;
}

/**
 * Get SharePoint site ID
 */
async function getSiteId() {
    try {
        const client = getGraphClient();

        // Try to get the root site first
        let site;
        try {
            // Method 1: Get site by hostname only (root site)
            site = await client.api(`/sites/${SHAREPOINT_CONFIG.siteHost}`).get();
        } catch (e1) {
            logToFile(`[SharePoint] Method 1 failed: ${e1.message}`);
            try {
                // Method 2: Search for the site
                const searchResult = await client.api('/sites').filter(`siteCollection/hostname eq '${SHAREPOINT_CONFIG.siteHost}'`).get();
                if (searchResult.value && searchResult.value.length > 0) {
                    site = searchResult.value[0];
                }
            } catch (e2) {
                logToFile(`[SharePoint] Method 2 failed: ${e2.message}`);
                // Method 3: Try with full path format
                try {
                    site = await client.api(`/sites/${SHAREPOINT_CONFIG.siteHost}:/`).get();
                } catch (e3) {
                    logToFile(`[SharePoint] Method 3 failed: ${e3.message}`);
                    throw new Error(`Cannot access SharePoint site. Please check:\n1. Azure App has 'Sites.Read.All' permission\n2. Admin consent is granted\n3. Site URL is correct: ${SHAREPOINT_CONFIG.siteHost}`);
                }
            }
        }

        if (!site || !site.id) {
            throw new Error('Site not found or no access granted');
        }

        logToFile(`[SharePoint] Site ID: ${site.id}`);
        return site.id;
    } catch (error) {
        const errorMessage = error.body ? JSON.stringify(error.body) : error.message;
        logToFile(`[SharePoint] Error getting site ID: ${errorMessage}`);
        throw new Error(`SharePoint access error: ${error.message}`);
    }
}

/**
 * Search for the Excel file in SharePoint
 * @param {string} siteId - SharePoint site ID
 * @param {string} fileName - Name of the Excel file to find
 */
async function findExcelFile(siteId, fileName) {
    try {
        const client = getGraphClient();

        // Search for the file in the site's drive
        const searchResult = await client
            .api(`/sites/${siteId}/drive/root/search(q='${fileName}')`)
            .get();

        if (searchResult.value && searchResult.value.length > 0) {
            const file = searchResult.value.find(f => f.name === fileName);
            if (file) {
                logToFile(`[SharePoint] Found file: ${file.name}, ID: ${file.id}`);
                return file;
            }
        }

        throw new Error(`File not found: ${fileName}`);
    } catch (error) {
        logToFile(`[SharePoint] Error finding file: ${error.message}`);
        throw error;
    }
}

/**
 * Read Excel data from SharePoint
 * @param {string} sheetName - Name of the worksheet to read (optional)
 */
async function getExcelData(sheetName = SHAREPOINT_CONFIG.sheetName) {
    try {
        const client = getGraphClient();
        const siteId = await getSiteId();
        const file = await findExcelFile(siteId, SHAREPOINT_CONFIG.fileName);

        // Get the used range of the worksheet
        const usedRange = await client
            .api(`/sites/${siteId}/drive/items/${file.id}/workbook/worksheets('${sheetName}')/usedRange`)
            .get();

        logToFile(`[SharePoint] Read ${usedRange.values?.length || 0} rows from ${sheetName}`);

        // Convert to array of objects with headers
        if (usedRange.values && usedRange.values.length > 1) {
            const headers = usedRange.values[0];
            const rows = usedRange.values.slice(1);

            const data = rows.map((row, index) => {
                const obj = { _rowIndex: index + 2 }; // Excel row number (1-indexed + header)
                headers.forEach((header, i) => {
                    obj[header] = row[i];
                });
                return obj;
            });

            return {
                success: true,
                fileName: file.name,
                sheetName: sheetName,
                headers: headers,
                rowCount: data.length,
                data: data,
                lastModified: file.lastModifiedDateTime,
            };
        }

        return {
            success: true,
            fileName: file.name,
            sheetName: sheetName,
            headers: [],
            rowCount: 0,
            data: [],
            lastModified: file.lastModifiedDateTime,
        };

    } catch (error) {
        logToFile(`[SharePoint] Error reading Excel: ${error.message}`);
        return {
            success: false,
            error: error.message,
            data: [],
        };
    }
}

/**
 * List all worksheets in the Excel file
 */
async function listWorksheets() {
    try {
        const client = getGraphClient();
        const siteId = await getSiteId();
        const file = await findExcelFile(siteId, SHAREPOINT_CONFIG.fileName);

        const worksheets = await client
            .api(`/sites/${siteId}/drive/items/${file.id}/workbook/worksheets`)
            .get();

        return {
            success: true,
            fileName: file.name,
            sheets: worksheets.value.map(ws => ({
                id: ws.id,
                name: ws.name,
                position: ws.position,
            })),
        };
    } catch (error) {
        logToFile(`[SharePoint] Error listing worksheets: ${error.message}`);
        return {
            success: false,
            error: error.message,
            sheets: [],
        };
    }
}

module.exports = {
    getExcelData,
    listWorksheets,
    SHAREPOINT_CONFIG,
};
