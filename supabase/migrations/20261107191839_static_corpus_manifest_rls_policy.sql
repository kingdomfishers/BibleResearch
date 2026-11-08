-- CORP-01 Allow public read on public Macula import manifest and unmapped node evidence
GRANT SELECT ON TABLE bible_internal.macula_syntax_unmapped_nodes TO anon, authenticated;

CREATE POLICY macula_syntax_import_files_public_read
  ON bible_internal.macula_syntax_import_files
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY macula_syntax_unmapped_nodes_public_read
  ON bible_internal.macula_syntax_unmapped_nodes
  FOR SELECT
  TO anon, authenticated
  USING (true);
