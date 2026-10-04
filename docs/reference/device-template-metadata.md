# Device template version and OEM stamp

The library selection and imported-file preview read `Template/@Version`,
`Template/@MAPSVersion`, and `Template/@Author` from the decrypted file. The
catalog version remains visible in the list; the selected details use the file
header, as MAPS does.

Verified against the local MAPS decompilation:

- `IntesisBoxMAPS/CustomOpenTemplateFile.cs:82–83` reads the author and version
  when selecting a local template.
- `IntesisBoxMAPS.Protocols.MB.External/frmMbmTemplates.cs:169` resolves the
  imported template author through `IntesisOem.GetManufacturerName`.
- `IntesisBoxMAPS/IntesisOem.cs:116` maps OEM codes 0–7 to manufacturer names.
- `IntesisBoxMAPS.Protocols.MB.External/ModbusTemplate.cs:1079` writes
  `Author="-1"` for ordinary exports.

The web UI calls recognized OEM stamps “Signed by …”, `-1` or a missing author
“Unsigned”, and unrecognized or malformed author codes “Unknown”. This is the
MAPS author stamp, not independent certificate verification. File integrity
continues to be checked separately by the template decoder for every file.
Web-generated exports use `Author="-1"` so they do not claim HMS authorship.

Selecting a library entry reads metadata without creating an import token or
changing a project. Metadata is cached for the lifetime of the dialog. Late
responses for a previous selection are ignored; failures offer a retry and
leave download and normal preview available.
