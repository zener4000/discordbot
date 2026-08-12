# Bot de tickets y formulario WL

El bot permite configurar todo el sistema directamente desde Discord. La
configuración queda guardada al reiniciar el bot.

## Preparación

1. Instala [Node.js 20 o posterior](https://nodejs.org/).
2. Crea una aplicación y un bot en el [Discord Developer Portal](https://discord.com/developers/applications).
3. En la página **Bot**, activa **Message Content Intent**.
4. Invita al bot con los scopes `bot` y `applications.commands`.
5. Dale permisos para ver canales, enviar mensajes, leer el historial, gestionar
   canales y gestionar mensajes.
6. Copia `.env.example` como `.env` y añade el token, el ID de la aplicación y el
   ID del servidor.

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd start
```

## Configurar los tickets

Solo el propietario real del servidor puede ejecutar `/configurar`. Tener el
permiso de Administrador, todos los permisos o el rol de staff no permite usar
este comando. El propietario debe rellenar:

- `canal_panel`: dónde se publicará el botón para crear tickets.
- `categoria_tickets`: dónde se crearán los canales privados.
- `rol_staff`: quién podrá ver y atender los tickets.
- `canal_registros`: dónde se enviarán los formularios WL.
- `contenido_panel`: texto que aparecerá en el panel.
- `titulo_panel`: título opcional del panel.
- `mensaje_ticket`: mensaje opcional al crear el ticket.
- `boton_cerrar`: permite mostrar u ocultar el botón de cierre.
- `usuario_puede_cerrar`: decide si el creador puede cerrar su ticket. El staff
  siempre puede cerrarlo.

Al completar el comando, la configuración se guarda y el panel se publica
automáticamente. Para volver a publicar el mismo panel se puede usar `?panel`.

## Formulario WL y pagos

Dentro de un ticket se puede usar `/wl`, el botón **Formulario WL** o `?wl`. Por
una limitación de Discord, `?wl` muestra primero un botón; `/wl` abre el formulario
directamente. Solo los administradores pueden abrir y enviar este formulario.

El formulario pregunta únicamente qué se ha pagado. El bot detecta automáticamente
al administrador que lo envió, lo registra como la persona que recogió el pago y
guarda el historial incluso después de reiniciar. Después cambia el nombre del
ticket a `pendiente-de-whitelist` y bloquea el envío de mensajes para el creador
y el rol de staff.

### Comandos del historial

- `?list @usuario`: muestra los pagos recogidos por ese usuario. Solo pueden usarlo
  los administradores.
- `?borrarlista @usuario`: borra todo el historial de pagos recogidos por ese
  usuario. Solo puede usarlo el propietario real del servidor. También se aceptan
  los alias `?clearlist` y `?resetlist`.

Si alguien elimina del canal de registros un mensaje de pago enviado por el bot,
el propietario recibe un mensaje privado con los datos del registro. Si tiene los
mensajes privados cerrados, el bot intenta avisarle en el canal del sistema o en
el canal donde está publicado el panel.

Los administradores de Discord pueden saltarse los bloqueos de canal por
funcionamiento de la propia plataforma.

No compartas el archivo `.env` ni el token del bot.
