const { ClientSecretCredential } = require('@azure/identity');
const config = require('./src/config');
async function f() {
    const c = new ClientSecretCredential(config.auth.tenantId, config.auth.clientId, config.auth.clientSecret);
    const t = await c.getToken('https://analysis.windows.net/powerbi/api/.default');
    const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/e486dea8-7ef1-4806-a269-0385a41be187/graphql';
    const q = 'query { __type(name: "Query") { fields { name type { name ofType { name } } } } }';
    const r = await fetch(endpoint, { method: 'POST', headers: {'Content-Type':'application/json', 'Authorization': 'Bearer '+t.token}, body: JSON.stringify({query: q})});
    const json = await r.json();
    const field = json.data.__type.fields.find(f => f.name === 'serviceOrderTable_Import_DataBase_238s');
    console.log("Query Type info:", JSON.stringify(field, null, 2));
    
    // usually connection type name is something like ServiceOrderTable_Import_DataBase_238Connection
    const typeName = field.type.name || field.type.ofType?.name;
    const q2 = `query { __type(name: "${typeName}") { fields { name type { name ofType { name ofType { name } } } } } }`;
    const r2 = await fetch(endpoint, { method: 'POST', headers: {'Content-Type':'application/json', 'Authorization': 'Bearer '+t.token}, body: JSON.stringify({query: q2})});
    const json2 = await r2.json();
    console.log("Connection Type info:", JSON.stringify(json2.data.__type, null, 2));
    
    const itemsField = json2.data.__type.fields.find(f => f.name === 'items');
    const itemTypeName = itemsField.type.ofType?.ofType?.name || itemsField.type.ofType?.name || itemsField.type.name;
    
    const q3 = `query { __type(name: "${itemTypeName}") { fields { name } } }`;
    const r3 = await fetch(endpoint, { method: 'POST', headers: {'Content-Type':'application/json', 'Authorization': 'Bearer '+t.token}, body: JSON.stringify({query: q3})});
    const json3 = await r3.json();
    const fields = json3.data.__type.fields.map(f => f.name);
    console.log("Fields:\n", fields.join('\n'));
}
f();
