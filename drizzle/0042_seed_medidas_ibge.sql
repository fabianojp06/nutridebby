-- Gerado por `pnpm seed:medidas` a partir de seeds/medidas-ibge.csv (IBGE, POF 2008–2009). Não editar.
ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":20},{"nome":"colher de arroz cheia","plural":"colheres de arroz cheias","gramas":63},{"nome":"escumadeira média cheia","plural":"escumadeiras médias cheias","gramas":59}]'::jsonb WHERE "taco_id" = 1;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":25},{"nome":"colher de arroz cheia","plural":"colheres de arroz cheias","gramas":45},{"nome":"escumadeira média cheia","plural":"escumadeiras médias cheias","gramas":85}]'::jsonb WHERE "taco_id" = 3;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":15}]'::jsonb WHERE "taco_id" = 7;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"unidade","plural":"unidades","gramas":5}]'::jsonb WHERE "taco_id" = 13;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"unidade","plural":"unidades","gramas":50}]'::jsonb WHERE "taco_id" = 53;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"folha média","plural":"folhas médias","gramas":10}]'::jsonb WHERE "taco_id" = 78;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":30},{"nome":"unidade pequena","plural":"unidades pequenas","gramas":70},{"nome":"escumadeira média cheia","plural":"escumadeiras médias cheias","gramas":80}]'::jsonb WHERE "taco_id" = 91;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia (picado)","plural":"colheres de sopa cheias (picado)","gramas":10}]'::jsonb WHERE "taco_id" = 100;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"unidade média","plural":"unidades médias","gramas":120},{"nome":"colher de sopa cheia (ralada)","plural":"colheres de sopa cheias (ralada)","gramas":12}]'::jsonb WHERE "taco_id" = 110;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":16},{"nome":"colher de sobremesa cheia","plural":"colheres de sobremesa cheias","gramas":10}]'::jsonb WHERE "taco_id" = 122;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"fatia média","plural":"fatias médias","gramas":15}]'::jsonb WHERE "taco_id" = 157;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia (picado)","plural":"colheres de sopa cheias (picado)","gramas":45}]'::jsonb WHERE "taco_id" = 163;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"unidade","plural":"unidades","gramas":75}]'::jsonb WHERE "taco_id" = 182;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"unidade média","plural":"unidades médias","gramas":180}]'::jsonb WHERE "taco_id" = 214;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"unidade média","plural":"unidades médias","gramas":150},{"nome":"unidade pequena","plural":"unidades pequenas","gramas":90}]'::jsonb WHERE "taco_id" = 222;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":40},{"nome":"unidade pequena","plural":"unidades pequenas","gramas":270}]'::jsonb WHERE "taco_id" = 226;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de chá cheia","plural":"colheres de chá cheias","gramas":8},{"nome":"ponta de faca","plural":"pontas de faca","gramas":5}]'::jsonb WHERE "taco_id" = 261;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa","plural":"colheres de sopa","gramas":8}]'::jsonb WHERE "taco_id" = 272;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"bife médio","plural":"bifes médios","gramas":100}]'::jsonb WHERE "taco_id" = 377;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"unidade","plural":"unidades","gramas":200}]'::jsonb WHERE "taco_id" = 448;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"fatia média","plural":"fatias médias","gramas":30}]'::jsonb WHERE "taco_id" = 461;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"fatia média","plural":"fatias médias","gramas":20}]'::jsonb WHERE "taco_id" = 463;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":30}]'::jsonb WHERE "taco_id" = 468;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"unidade média","plural":"unidades médias","gramas":45}]'::jsonb WHERE "taco_id" = 488;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de chá cheia","plural":"colheres de chá cheias","gramas":5},{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":24}]'::jsonb WHERE "taco_id" = 494;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"pedaço médio","plural":"pedaços médios","gramas":135}]'::jsonb WHERE "taco_id" = 533;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":17},{"nome":"colher de arroz cheia","plural":"colheres de arroz cheias","gramas":35},{"nome":"concha média cheia","plural":"conchas médias cheias","gramas":140}]'::jsonb WHERE "taco_id" = 561;
UPDATE "foods" SET "medidas_caseiras" = '[{"nome":"colher de sopa cheia","plural":"colheres de sopa cheias","gramas":17},{"nome":"colher de arroz cheia","plural":"colheres de arroz cheias","gramas":35},{"nome":"concha média cheia","plural":"conchas médias cheias","gramas":140}]'::jsonb WHERE "taco_id" = 567;
--> statement-breakpoint
ALTER TABLE "foods" FORCE ROW LEVEL SECURITY;
