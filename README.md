# CEREBRO v5 — Google Drive

## Para el usuario final
Solo:
1. Abrir CEREBRO.
2. Pulsar **Google Drive**.
3. Pulsar **Conectar Drive**.
4. Elegir cuenta.
5. Aceptar.

No copia tokens. No introduce claves. No configura APIs.

CEREBRO crea una carpeta `CEREBRO` y trabaja dentro de ella.

## Configuración única del propietario de CEREBRO
Google exige que el propietario cree/configure una credencial OAuth Web una vez.

Variables privadas:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `CEREBRO_TOKENS_KEY`

`GOOGLE_REDIRECT_URI`:
`https://TU-DOMINIO/api/cloud/drive/callback`

Luego:
```bash
npm install
npm run check:drive
npm start
```

## Seguridad
- Scope: `drive.file`, no acceso completo indiscriminado.
- OAuth se ejecuta en servidor.
- `client_secret` nunca llega al navegador.
- refresh/access tokens cifrados con AES-256-GCM.
- renovación automática de access tokens.
- desconectar Drive elimina la copia local de tokens.
