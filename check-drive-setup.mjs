#!/usr/bin/env node
/**
 * CEREBRO Drive setup helper.
 * It cannot create the OAuth client on your behalf because Google requires
 * the project owner to approve/configure that resource in Google Cloud.
 * It validates the four private environment variables and prints the exact
 * redirect URI that must be registered.
 */
const required=["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI","CEREBRO_TOKENS_KEY"];
const missing=required.filter(k=>!process.env[k]);
console.log("CEREBRO · Google Drive setup");
console.log("--------------------------------");
if(missing.length){
  console.log("Faltan:",missing.join(", "));
  console.log("\nConfigúralas como variables privadas en tu hosting.");
  console.log("GOOGLE_REDIRECT_URI debe terminar en /api/cloud/drive/callback");
  process.exitCode=1;
}else{
  console.log("OK: configuración privada completa.");
  console.log("Redirect URI:",process.env.GOOGLE_REDIRECT_URI);
  console.log("CEREBRO_TOKENS_KEY:",process.env.CEREBRO_TOKENS_KEY.length>=32?"OK":"DEMASIADO CORTA (usa 32+ caracteres)");
}
