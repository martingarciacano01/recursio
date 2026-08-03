-- 0043_storage_ruta_empresa.sql — aisla nom-documentos por carpeta de empresa
--
-- 0032_documentos_legajo.sql creó el bucket privado `nom-documentos` con
-- una policy que solo chequeaba `bucket_id = 'nom-documentos'`: cualquier
-- usuario autenticado del proyecto podía leer/escribir/borrar CUALQUIER
-- archivo del bucket, de cualquier empresa, con solo conocer (o adivinar)
-- el storage_path. src/store/documentosStore.js:102 ya sube todo bajo
-- `{empresaId}/{personalId}/...`, así que alcanza con exigir que el
-- primer segmento de la ruta coincida con la empresa del usuario.
DROP POLICY IF EXISTS nom_documentos_storage_rw ON storage.objects;
CREATE POLICY nom_documentos_storage_rw ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'nom-documentos'
         AND (storage.foldername(name))[1] = (SELECT auth_empresa_id())::text)
  WITH CHECK (bucket_id = 'nom-documentos'
         AND (storage.foldername(name))[1] = (SELECT auth_empresa_id())::text);
