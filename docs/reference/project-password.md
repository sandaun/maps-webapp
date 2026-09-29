# Contrasenya del projecte abans de desplegar

Revisat contra el codi descompilat de MAPS el 2026-09-29. S'aplica a les tres
famílies suportades: KNX–MBM, ME–MBS i MBS–KNX.

## Com ho fa MAPS

Fonts sota `temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/`:

- `IntesisBoxMAPS/ProjectParser.cs:1552` llegeix `IBOX/Pwd` a `ConfigPwd`.
  `Connection/Pwd` es llegeix separadament a `ConnectionPwd` (`:1638`, `:1646`):
  és la contrasenya de connexió, no la configuració que s'enviarà.
- `IntesisBoxMAPS.Projects/IntesisProject.cs:2325` desa `ConfigPwd` a `IBOX/Pwd`.
  `PasswordNeeded` és `true` per defecte (`:414`); les tres famílies suportades
  no el sobreescriuen.
- `IntesisBoxMAPS/frmMain.cs:7413-7422` bloqueja l'enviament quan
  `PasswordNeeded && !TypeUtils.CheckPasswordIntegrity(ConfigPwd)`, selecciona
  Configuration i obre el diàleg de canvi.
- `IntesisBoxMAPS.IntesisUtils/TypeUtils.cs:712-722`: el control d'enviament
  rebutja la cadena buida i els caràcters no ASCII. `IsASCII` (`:508-510`)
  compara bytes UTF-8 amb longitud. No comprova força ni longitud màxima.
- `IntesisBoxMAPS/frmGateway.cs:643-650` obre `frmProtectProject` amb
  `FormMode.PWD_CONNECTION`. No demana la contrasenya anterior.
- `IntesisBoxMAPS.Forms.Security/frmProtectProject.cs`: Save exigeix dues
  entrades no buides i iguals (`EqualPasswords`), valida amb `StringIsASCII`
  i limita **tots dos camps a 8 caràcters** (`InitializeComponent`).
  `StringIsASCII` (`TypeUtils.cs:749-764`) només accepta ASCII imprimible,
  de l'espai a `~`. No retalla espais ni exigeix complexitat.
- `IntesisBoxMAPS/IntesisXBL.cs:194` compila `ConfigPwd` amb
  `ConvertStringToByteArrayNull(..., 8, 9)`: 8 bytes més terminador NUL.

Les regles d'entrada i d'enviament són diferents al desktop. Conservem aquesta
distinció: una contrasenya importada ASCII de més de 8 caràcters supera el
control d'enviament de MAPS i el compilador existent la limita a 8 bytes;
l'editor web només permet desar 1–8 caràcters ASCII imprimibles.

## Implementació compartida

- `core/validation/project-password.ts`: les dues regles anteriors.
- `server/projects/password.ts`: llegeix només l'estat de validesa i aplica
  `setProjectPassword` sobre **un únic atribut**, `IBOX/Pwd`. El registre de
  famílies envia les tres implementacions al mateix helper.
- El patch usa el bloqueig de projecte, la revisió i les instantànies
  existents. La validació també s'executa al servei, no només a la UI.
- Les respostes JSON només afegeixen `passwordValid`; els models de família
  continuen excloent les contrasenyes. El fitxer `.ibmaps` i les instantànies
  del servidor conserven l'XML complet, com abans.
- Configuration → Security: nova contrasenya i confirmació, desament explícit
  i camps buits després d'un desament correcte. La contrasenya actual no es
  retorna ni es mostra. Els camps no passen pel magatzem d'esborranys, i
  `CurrentProjectProvider` exclou aquest patch dels esdeveniments de desfer.
- `server/deploy/service.ts`: porta `password` compartida. Tant l'estat com
  l'enviament real la comproven. L'XML validat és el mateix que es compila i
  empaqueta, encara que hi hagi una edició posterior. Deploy ofereix un
  enllaç directe a Configuration → Security quan falta una contrasenya vàlida.
- `core/xbl/ibox-xml.ts` i el writer d'XBL ja llegien i escrivien `IBOX/Pwd`;
  no s'ha canviat el format binari.

## Verificació

Regressions amb fixtures sintètiques per a les tres famílies: persistència i
recàrrega; XML compacte i amb format; caràcters que necessiten escapament XML;
preservació de `Connection/Pwd` i de tots els altres bytes; rebuig atòmic i
conflictes de revisió; restauració d'historial; absència del secret a les
respostes JSON, esdeveniments i emmagatzematge del navegador; bloqueig abans
de l'enviament i bytes de contrasenya correctes a l'XBL enviat.

Les proves d'enviament utilitzen una sessió simulada; no canvien cap gateway.
