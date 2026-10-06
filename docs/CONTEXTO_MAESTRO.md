# CEREBRO — CONTEXTO MAESTRO

## Propósito
Cerebro es una aplicación privada para profesionales creativos (diseño, ilustración, fotografía, vídeo, web, docencia y disciplinas afines).

Su misión es:
- guardar trabajo creativo;
- organizarlo;
- crear carpetas y proyectos;
- renombrar archivos con una convención consistente;
- buscar contenido;
- mover archivos;
- subir imágenes y documentos;
- devolver/descargar archivos solicitados;
- mover a papelera;
- restaurar;
- borrar definitivamente solo con confirmación explícita;
- comprimir proyectos terminados;
- conservar memoria de ideas, citas, notas y referencias;
- actuar como asistente visual con voz y cara animada;
- aprender preferencias del usuario;
- servir como núcleo de un futuro asistente creativo inteligente.

## Identidad del producto
Nombre actual: CEREBRO.
La identidad visual no debe parecer un dashboard genérico ni una plantilla SaaS.
Debe sentirse como una aplicación diseñada por un equipo de producto de Apple:
- jerarquía clara;
- profundidad y capas;
- materiales translúcidos;
- animación funcional;
- microinteracciones;
- estados vivos;
- progressive disclosure;
- pocas acciones visibles a la vez;
- operaciones destructivas claramente diferenciadas;
- interfaz limpia pero no fría ni muerta.

## Cara
La cara es una parte central de la identidad.
Debe:
- parpadear de forma natural;
- mover la boca mientras habla;
- cambiar visualmente según acciones;
- transformarse temporalmente en iconos o símbolos para explicar algo mejor;
- indicar estados como buscar, guardar, organizar, renombrar, comprimir, pensar, escuchar o error.

## Primer acceso
La contraseña inicial es:
PacoRosco

En primer acceso:
1. pedir nombre del usuario;
2. preguntar cómo quiere que Cerebro le llame;
3. preguntar cómo quiere llamar al asistente;
4. permitir elegir personalidad;
5. permitir definir tono y estilo de respuesta.

La contraseña debe almacenarse con hash, nunca en texto plano.

## Arquitectura
Backend:
- Node.js
- Express
- express-session
- bcryptjs
- multer
- archiver
- helmet
- express-rate-limit

Frontend:
- HTML
- CSS
- JavaScript sin framework, para facilitar despliegue en Sered/cPanel.

Rutas principales:
- /public -> interfaz
- /storage -> archivos reales del usuario
- /trash -> papelera física
- /data -> perfil, memoria, seguridad, journal y metadatos
- /docs -> documentación persistente del proyecto

## Seguridad
Principios obligatorios:
- nunca permitir rutas fuera de /storage;
- no seguir enlaces simbólicos;
- password con bcrypt;
- CSRF en operaciones mutables;
- rate limit en login;
- cookie HttpOnly;
- SameSite strict;
- secure en producción;
- Helmet/CSP;
- borrado normal siempre pasa por papelera;
- borrado definitivo exige acción separada;
- renombrados masivos siempre requieren previsualización;
- operaciones complejas deben dejar registro;
- no romper archivos enlazados sin advertencia.

## Gestión profesional de archivos
Convención:
CODIGO-TIPO-DESCRIPCION-v###-AAAAMMDD.ext

Ejemplo:
GC26-ILUS-cartel_principal-v003-20261006.ai

Reglas:
- sin caracteres problemáticos;
- evitar espacios innecesarios;
- sin nombres FINAL FINAL 2;
- versión numérica ordenable;
- fecha ISO compacta;
- mantener extensión;
- no cambiar enlaces de Adobe sin control.

## Estructura de proyecto
Cada proyecto profesional crea:
00_ADMIN
01_REFERENCIAS
02_BOCETOS
03_ORIGINALES
04_RECURSOS
05_VERSIONES
06_EXPORTACIONES
07_ENTREGA
08_ARCHIVO

Además:
PROJECT_MANIFEST.json

## Renombrado masivo
Nunca renombrar directamente.
Flujo obligatorio:
1. analizar;
2. generar plan;
3. mostrar previsualización;
4. pedir confirmación;
5. aplicar en dos fases;
6. guardar RENAME_MANIFEST.json;
7. registrar la operación en journal.

## Papelera
- mover a papelera es reversible;
- restaurar debe intentar recuperar la ruta original;
- borrar definitivamente solo desde Papelera;
- si la ruta original está ocupada, no sobrescribir.

## Archivo de proyecto
Al archivar:
- comprimir carpeta completa;
- generar ZIP;
- calcular SHA-256;
- registrar hash en journal;
- devolver el archivo al usuario.

## Memoria
Cerebro puede guardar:
- ideas;
- citas;
- notas;
- referencias.

Futuro:
- imágenes como memoria visual;
- búsqueda semántica;
- relaciones entre proyectos;
- preferencias aprendidas.

## Órdenes naturales actuales
Soportadas:
- crea una carpeta X
- busca X
- guarda idea: X
- guarda nota: X

Futuro:
- ordena esta carpeta;
- detecta duplicados;
- clasifica imágenes;
- busca por contenido visual;
- revisa un proyecto;
- archiva y guarda copia;
- reorganiza según plantilla;
- encuentra la última versión aprobada.

## Regla crítica para futuras modificaciones
NO REESCRIBIR TODO EL PROYECTO SIN NECESIDAD.

Antes de tocar código:
1. leer este CONTEXTO_MAESTRO.md;
2. leer ARCHITECTURE.json;
3. leer CHANGELOG.md;
4. revisar server.mjs;
5. revisar public/app.js;
6. determinar causa raíz;
7. hacer cambios mínimos y reversibles;
8. actualizar CHANGELOG.md;
9. actualizar ARCHITECTURE.json si cambia estructura;
10. validar sintaxis.

Nunca eliminar funciones existentes sin orden explícita.

## v4 — Identidad y seguridad
- El nombre del asistente lo define el usuario.
- La personalidad la define el usuario.
- El tono/estilo de respuesta lo define el usuario.
- Puede activar/desactivar voz.
- Puede reducir movimiento.
- La contraseña inicial no aparece en texto claro dentro del código ejecutable.
- El arranque contiene solo sal + hash scrypt.
- Las nuevas contraseñas se guardan únicamente como sal + hash en data/settings.json.


## v5 — Google Drive como nube externa
CEREBRO integra Google Drive con OAuth 2.0 de servidor.

Principio de mínima autorización:
- usa `https://www.googleapis.com/auth/drive.file`;
- CEREBRO crea una carpeta `CEREBRO` en el Drive del usuario;
- gestiona los archivos y carpetas creados/subidos por la aplicación;
- no pide acceso indiscriminado a todo el Drive.

Experiencia del usuario:
1. pulsa Conectar Drive;
2. elige su cuenta Google;
3. acepta;
4. CEREBRO crea/encuentra su carpeta CEREBRO;
5. a partir de ahí lista, crea carpetas, sube, descarga, renombra, mueve y manda a papelera.

El servidor solicita `access_type=offline` y guarda el refresh token cifrado con AES-256-GCM.
La librería oficial `googleapis` renueva access tokens automáticamente.

Configuración única del propietario:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI
- CEREBRO_TOKENS_KEY

Nunca poner client_secret ni refresh_token en HTML/app.js.
