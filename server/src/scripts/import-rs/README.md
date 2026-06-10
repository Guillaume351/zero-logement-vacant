# Import RS 2026

## 1. Comment je lance l’import

Depuis la racine du dépôt (**dry-run**) :

```bash
yarn workspace @zerologementvacant/server tsx src/scripts/import-rs/index.ts --dry-run recrutement/fixtures/rs-2026.jsonl.gz
```

Le dry-run permet de dérouler le pipeline sans écrire en base.

Pour lancer l’import réel :

```bash
yarn workspace @zerologementvacant/server migrate
yarn workspace @zerologementvacant/server tsx src/scripts/import-rs/index.ts recrutement/fixtures/rs-2026.jsonl.gz
```

Le script produit un rapport local :

```text
import-rs-2026.report.json
```

Les rejets sont agrégés dans le rapport avec quelques exemples, au lieu d’être loggés ligne par ligne.

J’ai vérifié le code avec :

```bash
yarn nx typecheck server
yarn nx test server -- src/scripts/import-rs
```

## 2. Architecture choisie et pourquoi

J’ai d’abord regardé les imports existants, en particulier LOVAC, pour rester proche des conventions du projet.

J’ai créé un pipeline dédié `server/src/scripts/import-rs`, calqué sur l’approche EETL déjà utilisée :

```text
Source gzip JSONL
-> validation
-> enrichissement bulk par (geo_code, local_id)
-> transformation pure
-> chargement bulk
```

Pourquoi :

- le fichier contient 1 million de lignes, donc je voulais éviter une requête SQL par ligne ;
- `fast_housing` est volumineuse, donc l’enrichissement se fait par batch ;
- `fast_housing` est partitionnée par `geo_code`, donc l’enrichissement regroupe les lignes par partition ;
- j’avais d’abord utilisé un `whereIn` sur `(geo_code, local_id)`, comme dans LOVAC, mais c’était lent sur les batchs RS mélangés. J’ai donc regroupé les lignes par partition de `geo_code`, puis remplacé le `whereIn` par un `FROM (VALUES ...) JOIN`, ce qui permet à Postgres de travailler sur la bonne partition avec un plan beaucoup plus efficace ;
- le chargement utilise une table temporaire et un `UPDATE ... FROM`, comme les imports massifs existants ;
- le loader ne met à jour que les champs nécessaires : `occupancy`, `status`, `rs_source`, `data_file_years`.

Les autres champs sont volontairement préservés, notamment `sub_status`, `rental_value`, `occupancy_intended`, les précisions, les campagnes et les propriétaires.

Pour la traçabilité, je réutilise les événements applicatifs existants :

- `housing:occupancy-updated` ;
- `housing:status-updated`.

Les IDs d’événements sont déterministes avec UUID v5 et insérés avec `ON CONFLICT DO NOTHING`, ce qui rend la relance idempotente.

## 3. Ce que j’ai fait / pas fait / ferais ensuite

Ce que j’ai fait :

- ajouté le script `server/src/scripts/import-rs` ;
- ajouté la lecture streaming du fichier `.jsonl.gz` ;
- ajouté la validation des lignes source ;
- ajouté l’enrichissement par batch sur la clé métier `(geo_code, local_id)` ;
- optimisé l’enrichissement pour respecter le partitionnement de `fast_housing` ;
- ajouté l’update bulk limité à `occupancy`, `status`, `rs_source`, `data_file_years` ;
- ajouté le millésime `rs-2026` dans les modèles partagés ;
- ajouté la création d’événements d’historique ;
- ajouté un reporter dédié pour agréger les rejets ;
- ajouté l’import de `rs_source` pour le bonus ;
- ajouté un filtre et un badge côté interface ;
- ajouté des tests de transformation ;
- ajouté des tests d’intégration du loader et de l’enricher.

## 4. Cas du fichier source identifiés et traitement

J’ai inspecté le fichier avec DuckDB avant de coder l’import :

Depuis la racine du dépôt, je lance une session DuckDB en mémoire :

```bash
cd /chemin/vers/fork-entretien
duckdb :memory:
```

Puis je crée une vue sur le fichier source :

```sql
CREATE OR REPLACE VIEW rs AS
SELECT *
FROM read_json_auto(
  'recrutement/fixtures/rs-2026.jsonl.gz',
  format = 'newline_delimited'
);
```

Requêtes principales :

```sql
-- Volume
SELECT count(*) AS total FROM rs;

-- Schéma détecté
DESCRIBE rs;

-- Champs obligatoires manquants
SELECT
  count(*) FILTER (WHERE geo_code IS NULL OR geo_code = '') AS missing_geo_code,
  count(*) FILTER (WHERE local_id IS NULL OR local_id = '') AS missing_local_id
FROM rs;

-- Distribution rs_source
SELECT coalesce(rs_source, '__MISSING__') AS rs_source, count(*) AS n
FROM rs
GROUP BY 1
ORDER BY n DESC;

-- Doublons de clé métier
SELECT geo_code, local_id, count(*) AS n
FROM rs
GROUP BY geo_code, local_id
HAVING count(*) > 1
ORDER BY n DESC;
```

Ce que j’ai identifié :

- 1 000 000 lignes ;
- pas de JSON invalide ;
- pas de `geo_code` ou `local_id` manquant ;
- 6 clés métier dupliquées ;
- 3 lignes sans `rs_source`.

Traitement retenu :

- logement trouvé par `(geo_code, local_id)` : mise à jour en résidence secondaire, ajout de `rs-2026`, création d’événements si `occupancy` ou `status` change ;
- logement déjà à jour : ignoré, sauf si `rs_source` doit être complété ;
- logement non trouvé : rejeté et compté en erreur ;
- doublon de clé métier dans le fichier : première occurrence traitée, occurrences suivantes rejetées ;
- `rs_source` absent : accepté, la valeur reste `null`.

## 5. Bonus interface

J’ai ajouté une colonne nullable `rs_source` sur `fast_housing`, alimentée par l’import RS.

Côté interface, je peux tester à trois endroits :

- dans la liste des logements, panneau de filtres, accordéon “Fichiers sources”, filtre “Source RS” ;
- dans les badges de filtres actifs, après sélection d’une source RS ;
- dans la liste et sur la fiche logement, avec le badge “Source RS”.

Pour le voir avec les données locales, je lance la migration puis je relance l’import réel. Sans relance de l’import, les logements déjà passés en `rs-2026` restent sans source RS affichée.
