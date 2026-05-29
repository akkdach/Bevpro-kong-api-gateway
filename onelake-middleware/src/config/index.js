require('dotenv').config();
const path = require('path');

module.exports = {
    port: process.env.PORT || 3000,
    oneLake: {
        accountUrl: "https://onelake.dfs.fabric.microsoft.com",
        proIoT: {
            tableUrl: "abfss://7b2a2b84-0f67-4d1f-8e9f-65abfa88501d@onelake.dfs.fabric.microsoft.com/65a9b9c5-98b8-4879-b9ba-88eca966929a/Tables/smaserviceordertable",
            cacheFile: path.join(__dirname, '../../data_cache_proiot.json')
        },
        proIoTLine: {
            tableUrl: "abfss://7b2a2b84-0f67-4d1f-8e9f-65abfa88501d@onelake.dfs.fabric.microsoft.com/65a9b9c5-98b8-4879-b9ba-88eca966929a/Tables/smaserviceorderline",
            cacheFile: path.join(__dirname, '../../data_cache_proiot_line.json')
        },
        fsrProtal: {
            // Reuse the same table and cache as ProIoT (since source is the same)
            tableUrl: "abfss://7b2a2b84-0f67-4d1f-8e9f-65abfa88501d@onelake.dfs.fabric.microsoft.com/65a9b9c5-98b8-4879-b9ba-88eca966929a/Tables/smaserviceordertable",
            cacheFile: path.join(__dirname, '../../data_cache_proiot.json')
        }
    },
    limits: {
        batchSize: 10,      // Smaller batches
        maxRecords: 50000,  // Increased to 50k
        maxFiles: 1000      // Limit to 1000 as requested
    },
    auth: {
        tenantId: process.env.AZURE_TENANT_ID,
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET
    },
    sql: {
        server: "zf7yrpjhd77uxedw7r2suvgpv4-qqvsu63hb4pu3du7mwv7vccqdu.datawarehouse.fabric.microsoft.com",
        database: "dataverse_bevproasia_cds2_workspace_unq520782ff3395f011a701000d3aa2b",
        options: {
            encrypt: true,
            trustServerCertificate: false,
            connectTimeout: 30000,
            requestTimeout: 30000,
            port: 1433
        },
        authentication: {
            type: 'azure-active-directory-service-principal-secret',
            options: {
                clientId: process.env.AZURE_CLIENT_ID,
                clientSecret: process.env.AZURE_CLIENT_SECRET,
                tenantId: process.env.AZURE_TENANT_ID
            }
        },
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        }
    },
    qasSql: {
        server: process.env.QAS_DB_SERVER || 'localhost',
        database: process.env.QAS_DB_DATABASE || 'BevproFsQas',
        user: process.env.QAS_DB_USER || 'sa',
        password: process.env.QAS_DB_PASSWORD || '',
        options: {
            encrypt: false,
            trustServerCertificate: true,
            connectTimeout: 30000,
            requestTimeout: 30000,
            port: parseInt(process.env.QAS_DB_PORT) || 1433
        },
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        }
    },
    prodSql: {
        server: process.env.PROD_DB_SERVER || 'localhost',
        database: process.env.PROD_DB_DATABASE || 'BevproFsProd',
        user: process.env.PROD_DB_USER || 'sa',
        password: process.env.PROD_DB_PASSWORD || '',
        options: {
            encrypt: false,
            trustServerCertificate: true,
            connectTimeout: 30000,
            requestTimeout: 30000,
            port: parseInt(process.env.PROD_DB_PORT) || 1433
        },
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        }
    },
    syncSql: {
        server: process.env.SYNC_DB_SERVER || '20.33.118.76',
        database: process.env.SYNC_DB_DATABASE || 'D365',
        user: process.env.SYNC_DB_USER || 'sync_user',
        password: process.env.SYNC_DB_PASSWORD || 'Dui11223344@!',
        options: {
            encrypt: false,
            trustServerCertificate: true,
            connectTimeout: 30000,
            requestTimeout: 30000,
            port: parseInt(process.env.SYNC_DB_PORT) || 1433
        },
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        }
    },
    entra: {
        tenantId: process.env.ENTRA_TENANT_ID || process.env.AZURE_TENANT_ID,
        clientId: process.env.ENTRA_CLIENT_ID
    },
    freezeDataPath: '/app/freeze-data',
    cache: {
        memoryDuration: 10 * 60 * 1000, // 10 minutes
        diskDuration: 24 * 60 * 60 * 1000, // 24 hours
        diskDuration: 24 * 60 * 60 * 1000, // 24 hours
        // diskFile removed, now per-project in oneLake config
    }
};
