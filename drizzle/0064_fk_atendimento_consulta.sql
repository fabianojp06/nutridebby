-- Plano 03 (adiado) / Plano 05: o atendimento pode nascer da consulta da agenda ("Iniciar atendimento"). FK composta
-- (mesmo tenant e mesmo paciente: um atendimento nunca aponta para a consulta de outro paciente); declarada só aqui
-- porque a tabela appointments vive em outro arquivo de schema (import circular no Drizzle).
-- Consultas nunca são apagadas (cancelar muda o status), então NO ACTION basta.
ALTER TABLE consultations ADD CONSTRAINT consultations_consulta_fk
  FOREIGN KEY (tenant_id, patient_id, appointment_id) REFERENCES appointments (tenant_id, patient_id, id);
