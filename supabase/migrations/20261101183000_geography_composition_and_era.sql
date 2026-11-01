-- Additive migration: composition_location & audience_location support, curated book/epistle/prophetic provenance,
-- chronological era place names, and era_gazetteer in public.get_verse_geography.

alter table public.places
  add column if not exists active_eras text[] not null default '{}'::text[],
  add column if not exists period_names jsonb not null default '{}'::jsonb;

create index if not exists idx_places_active_eras_gin on public.places using gin(active_eras);

alter table public.passage_geography
  drop constraint if exists passage_geography_relationship_type_check;
alter table public.passage_geography
  add constraint passage_geography_relationship_type_check
  check (relationship_type in (
    'event_location',
    'contextual_location',
    'composition_location',
    'audience_location',
    'mentioned_location',
    'travel_origin',
    'travel_destination',
    'uncertain_location'
  ));

alter table public.verse_geography
  drop constraint if exists verse_geography_relationship_type_check;
alter table public.verse_geography
  add constraint verse_geography_relationship_type_check
  check (relationship_type in (
    'event_location',
    'contextual_location',
    'composition_location',
    'audience_location',
    'mentioned_location',
    'travel_origin',
    'travel_destination',
    'uncertain_location'
  ));

-- Populate period_names and active_eras on key biblical places
update public.places as p
set
  active_eras = v.active_eras,
  period_names = v.period_names
from (values
('openbible:a6d9af3',ARRAY['primeval_patriarchal','monarchy_divided_kingdom']::text[],'{"primeval_patriarchal":"Haran / Charan (חָרָן · Paddan-aram)","monarchy_divided_kingdom":"Haran (חָרָן · Upper Aram)"}'::jsonb),
('openbible:af725b1',ARRAY['primeval_patriarchal','exile_persian']::text[],'{"primeval_patriarchal":"Shinar / Sumer & Akkad (שִׁנְעָר)","exile_persian":"Shinar / Babylonia (שִׁנְעָר)"}'::jsonb),
('openbible:a217d18',ARRAY['primeval_patriarchal','monarchy_divided_kingdom','exile_persian']::text[],'{"primeval_patriarchal":"Babel (בָּבֶל · Shinar)","monarchy_divided_kingdom":"Babylon (בָּבֶל · Chaldea)","exile_persian":"Babylon / Bavel (בָּבֶל · Imperial Capital)"}'::jsonb),
('openbible:aeb9e97',ARRAY['primeval_patriarchal']::text[],'{"primeval_patriarchal":"Mamre / Kiriath-arba (מַמְרֵא · Hebron)"}'::jsonb),
('openbible:a64f355',ARRAY['primeval_patriarchal','exodus_conquest_judges','monarchy_divided_kingdom']::text[],'{"primeval_patriarchal":"Luz / Bethel (לוּז · בֵּית־אֵל)","exodus_conquest_judges":"Bethel (בֵּית־אֵל)","monarchy_divided_kingdom":"Bethel Royal Sanctuary (בֵּית־אֵל)"}'::jsonb),
('openbible:ad2f6c2',ARRAY['primeval_patriarchal','monarchy_divided_kingdom']::text[],'{"primeval_patriarchal":"Beersheba (בְּאֵר שֶׁבַע · Negev)","monarchy_divided_kingdom":"Beersheba (בְּאֵר שֶׁבַע · Southern Border)"}'::jsonb),
('openbible:af301ca',ARRAY['primeval_patriarchal','exodus_conquest_judges','monarchy_divided_kingdom','exile_persian']::text[],'{"primeval_patriarchal":"Mitzrayim / Egypt (מִצְרַיִם)","exodus_conquest_judges":"Mitzrayim / Goshen (מִצְרַיִם)","monarchy_divided_kingdom":"Egypt (מִצְרַיִם)","exile_persian":"Egypt / Satrapy of Mudraya (מִצְרַיִם)"}'::jsonb),
('openbible:a69c1d4',ARRAY['primeval_patriarchal','monarchy_divided_kingdom','roman_new_testament']::text[],'{"primeval_patriarchal":"Damascus / Dammeseq (דַּמֶּשֶׂק)","monarchy_divided_kingdom":"Damascus / Aram-Damascus (דַּמֶּשֶׂק)","roman_new_testament":"Damaskos / Damascus (Δαμασκός · Syria)"}'::jsonb),
('openbible:a15257a',ARRAY['primeval_patriarchal','exodus_conquest_judges','monarchy_divided_kingdom','exile_persian','roman_new_testament']::text[],'{"primeval_patriarchal":"Salem / Moriah (שָׁלֵם · מֹרִיָּה)","exodus_conquest_judges":"Jebus / Jerusalem (יְבוּס · יְרוּשָׁלִַם)","monarchy_divided_kingdom":"Jerusalem / City of David (יְרוּשָׁלִַם · צִיּוֹן)","exile_persian":"Jerusalem / Yehud Medinata (יְרוּשְׁלֶם)","roman_new_testament":"Hierosolyma / Jerusalem (Ἱεροσόλυμα · Judaea)"}'::jsonb),
('openbible:abfba2a',ARRAY['exodus_conquest_judges']::text[],'{"exodus_conquest_judges":"Mount Sinai / Horeb (הַר סִינַי · חֹרֵב)"}'::jsonb),
('openbible:ad3970d',ARRAY['exodus_conquest_judges']::text[],'{"exodus_conquest_judges":"Marah in Shur (מָרָה)"}'::jsonb),
('openbible:a05ebb7',ARRAY['exodus_conquest_judges']::text[],'{"exodus_conquest_judges":"Rephidim (רְפִידִים)"}'::jsonb),
('openbible:acc6d8e',ARRAY['exodus_conquest_judges']::text[],'{"exodus_conquest_judges":"Land of Midian (מִדְיָן)"}'::jsonb),
('openbible:ac2cef0',ARRAY['exodus_conquest_judges']::text[],'{"exodus_conquest_judges":"Kadesh-barnea (קָדֵשׁ בַּרְנֵעַ · Paran)"}'::jsonb),
('openbible:aa0b1d6',ARRAY['exodus_conquest_judges','monarchy_divided_kingdom']::text[],'{"exodus_conquest_judges":"Plains of Moab (עַרְבוֹת מוֹאָב)","monarchy_divided_kingdom":"Kingdom of Moab (מוֹאָב)"}'::jsonb),
('openbible:aefaa2d',ARRAY['exodus_conquest_judges']::text[],'{"exodus_conquest_judges":"Mount Nebo / Pisgah (הַר נְבוֹ)"}'::jsonb),
('openbible:a041bb3',ARRAY['monarchy_divided_kingdom','roman_new_testament']::text[],'{"monarchy_divided_kingdom":"Samaria / Shomeron (שֹׁמְרוֹן · Capital of Israel)","roman_new_testament":"Samareia / Sebaste (Σαμάρεια)"}'::jsonb),
('openbible:a112427',ARRAY['exodus_conquest_judges','monarchy_divided_kingdom','roman_new_testament']::text[],'{"exodus_conquest_judges":"Bethlehem / Ephrathah (בֵּית לֶחֶם)","monarchy_divided_kingdom":"Bethlehem of Judah (בֵּית לֶחֶם יְהוּדָה)","roman_new_testament":"Bethleem (Βηθλέεμ · Judaea)"}'::jsonb),
('openbible:a70fd5d',ARRAY['monarchy_divided_kingdom','exile_persian']::text[],'{"monarchy_divided_kingdom":"Nineveh (נִינְוֵה · Neo-Assyrian Capital)","exile_persian":"Nineveh Ruins (נִינְוֵה · Assyria)"}'::jsonb),
('openbible:a2e3aa0',ARRAY['monarchy_divided_kingdom']::text[],'{"monarchy_divided_kingdom":"Tekoa in Judah (תְּקוֹעַ)"}'::jsonb),
('openbible:a2735ff',ARRAY['exodus_conquest_judges','monarchy_divided_kingdom','exile_persian']::text[],'{"exodus_conquest_judges":"Land of Edom / Seir (אֱדוֹם)","monarchy_divided_kingdom":"Kingdom of Edom (אֱדוֹם · Bozrah)","exile_persian":"Edom / Idumea (אֱדוֹם)"}'::jsonb),
('openbible:ae023a9',ARRAY['monarchy_divided_kingdom','roman_new_testament']::text[],'{"monarchy_divided_kingdom":"Joppa / Yafo Port (יָפוֹ)","roman_new_testament":"Ioppe / Joppa (Ἰόππη)"}'::jsonb),
('openbible:a033b84',ARRAY['exile_persian']::text[],'{"exile_persian":"Shushan the Citadel / Susa (שׁוּשַׁן הַבִּירָה · Elam)"}'::jsonb),
('openbible:a7a7549',ARRAY['exile_persian']::text[],'{"exile_persian":"Ulai Canal / Eulaeus River (אוּלַי · Susa)"}'::jsonb),
('openbible:a3d2f0a',ARRAY['exile_persian']::text[],'{"exile_persian":"Chebar / Kebar Canal (נְהַר־כְּבָר · Nippur/Babylonia)"}'::jsonb),
('openbible:a38ebfd',ARRAY['primeval_patriarchal','monarchy_divided_kingdom','exile_persian']::text[],'{"primeval_patriarchal":"Hiddekel / Tigris River (חִדֶּקֶל)","monarchy_divided_kingdom":"Tigris River (חִדֶּקֶל · Assyria)","exile_persian":"Great River Hiddekel / Tigris (חִדֶּקֶל)"}'::jsonb),
('openbible:adb008c',ARRAY['exile_persian']::text[],'{"exile_persian":"Tahpanhes / Daphnae (תַּחְפַּנְחֵס · Nile Delta)"}'::jsonb),
('openbible:a27b472',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Sychar by Jacob’s Well (Συχάρ · Samaria)"}'::jsonb),
('openbible:af2161c',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Kapharnaoum / Capernaum (Καφαρναούμ · Galilee)"}'::jsonb),
('openbible:af5884f',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Nazaret / Nazareth (Ναζαρέτ · Galilee)"}'::jsonb),
('openbible:a58735e',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Kaisareia Maritima (Καισάρεια · Roman Judaea Capital)"}'::jsonb),
('openbible:ae41ab4',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Antiocheia on the Orontes (Ἀντιόχεια · Roman Syria)"}'::jsonb),
('openbible:a6c704a',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Pisidian Antiocheia (Ἀντιόχεια τῆς Πισιδίας · Galatia)"}'::jsonb),
('openbible:a4e5a69',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Colossae / Colossia (Κολοσσαί · Lycus Valley, Phrygia)"}'::jsonb),
('openbible:a5feb15',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Ephesos / Ephesus (Ἔφεσος · Roman Asia Capital)"}'::jsonb),
('openbible:a83fb1e',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Laodikeia on the Lycus (Λαοδίκεια · Phrygia, Asia)"}'::jsonb),
('openbible:a2e65fb',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Smyrna (Σμύρνα · Roman Asia)"}'::jsonb),
('openbible:a75d2c1',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Pergamon / Pergamum (Πέργαμον · Roman Asia)"}'::jsonb),
('openbible:a94b661',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Thyateira / Thyatira (Θυάτειρα · Lydia, Asia)"}'::jsonb),
('openbible:aab4a5f',ARRAY['exile_persian','roman_new_testament']::text[],'{"exile_persian":"Sepharad / Sardis (סְפָרַד · Lydia)","roman_new_testament":"Sardeis / Sardis (Σάρδεις · Roman Asia)"}'::jsonb),
('openbible:a1c7cc1',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Philadelpheia (Φιλαδέλφεια · Roman Asia)"}'::jsonb),
('openbible:a8f60f3',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Island of Patmos (Πάτμος · Aegean Sea)"}'::jsonb),
('openbible:a49e1d0',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Philippoi / Colonia Philippi (Φίλιπποι · Macedonia)"}'::jsonb),
('openbible:afa9d8e',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Thessalonike (Θεσσαλονίκη · Macedonia Capital)"}'::jsonb),
('openbible:a1fe6e7',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Athenai / Athens (Ἀθῆναι · Achaia)"}'::jsonb),
('openbible:a6f437a',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Korinthos / Corinth (Κόρινθος · Achaia Capital)"}'::jsonb),
('openbible:afc8e7a',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Rhome / Imperial Rome (Ῥώμη · Italia)"}'::jsonb),
('openbible:a26aa94',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Krete / Island of Crete (Κρήτη)"}'::jsonb),
('openbible:af43cde',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Nikopolis in Epirus (Νικόπολις)"}'::jsonb),
('openbible:a0f440a',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Province of Galatia (Γαλατία · Anatolia)"}'::jsonb),
('openbible:a197f19',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Roman Province of Asia (Ἀσία · Western Anatolia)"}'::jsonb),
('openbible:a69e1b8',ARRAY['roman_new_testament']::text[],'{"roman_new_testament":"Roman Province of Macedonia (Μακεδονία)"}'::jsonb)
) as v(place_key, active_eras, period_names)
where p.place_key = v.place_key;

-- Upsert curated narrative, composition (where written), and audience (for whom/where written) passage contexts
insert into public.passage_geography(
  passage_key, title, book, start_chapter, start_verse, end_chapter, end_verse,
  place_id, relationship_type, resolution_tier, confidence_level,
  evidence_refs, evidence_explanation, source_id
)
select
  v.passage_key, v.title, v.book::smallint, v.start_chapter::smallint, v.start_verse::smallint,
  v.end_chapter::smallint, v.end_verse::smallint, pl.id, v.relationship_type,
  v.resolution_tier::smallint, v.confidence_level, v.evidence_refs, v.evidence_explanation, s.id
from (values
('gen-2-8-25-eden','Garden of Eden narrative in Greater Mesopotamia',1,2,8,3,24,'openbible:af3daeb','contextual_location',4,'regional','Genesis 2:8, 10-14','Genesis 2:10-14 connects the river system of Eden with the Tigris (Hiddekel) and Euphrates in Greater Mesopotamia, though the exact garden site is unknown.','curated_narrative_geography'),
('gen-11-1-9-shinar-babel','Tower of Babel on the plain of Shinar (Babylonia)',1,11,1,11,9,'openbible:af725b1','contextual_location',2,'established','Genesis 11:2, 9','Genesis 11:2 and 11:9 explicitly locate the narrative on a plain in the land of Shinar (Babylonia) at Babel.','curated_narrative_geography'),
('gen-12-10-20-abram-egypt','Abram’s sojourn in Egypt during the famine',1,12,10,12,20,'openbible:af301ca','contextual_location',2,'established','Genesis 12:10, 14','Genesis 12:10 establishes that Abram went down to Egypt to sojourn there throughout verses 10-20.','curated_narrative_geography'),
('gen-18-1-33-mamre','Visitors at the oaks of Mamre near Hebron',1,18,1,18,33,'openbible:aeb9e97','contextual_location',2,'established','Genesis 18:1; 13:18','Genesis 18:1 establishes the setting at the oaks of Mamre (near Hebron) for the entire dialogue of chapter 18.','curated_narrative_geography'),
('gen-19-1-29-sodom','Angels visit Lot in Sodom and the flight to Zoar',1,19,1,19,29,'openbible:a0aa664','contextual_location',2,'disputed','Genesis 19:1, 4, 22-24','Genesis 19:1 sets the narrative at the gate and house of Lot in Sodom (Southern vs. Northern Dead Sea basin proposals).','curated_narrative_geography'),
('gen-24-10-61-nahor-well-haran','Abraham’s servant meets Rebekah at the well of the city of Nahor (Aram-naharaim / Haran)',1,24,10,24,61,'openbible:a6d9af3','contextual_location',2,'regional','Genesis 24:10; 27:43; 29:4','Genesis 24:10 locates the well outside the city of Nahor in Aram-naharaim (Upper Mesopotamia / Haran district) without claiming exact GPS coordinates for the well itself.','curated_narrative_geography'),
('gen-28-10-22-bethel','Jacob’s dream at Bethel (formerly Luz)',1,28,10,28,22,'openbible:a64f355','contextual_location',2,'probable','Genesis 28:10, 19','Genesis 28:19 identifies the place where Jacob slept and saw the ladder vision as Bethel (formerly Luz).','curated_narrative_geography'),
('gen-29-1-14-haran-well-region','Jacob’s encounter with Rachel at the shepherds’ well in the pastoral region of Haran',1,29,1,29,14,'openbible:a6d9af3','contextual_location',2,'regional','Genesis 27:43; 28:10; 29:1, 4','Genesis 28:10 and 29:4 establish that Jacob traveled to the pastoral countryside around Haran in Paddan-aram (Upper Mesopotamia). The well in the field (Gen 29:2, 10) has no independent archaeological GPS pin and is represented by the approximate Haran regional context.','curated_narrative_geography'),
('gen-29-15-31-16-haran-laban','Jacob’s service in Laban’s household in Haran / Paddan-aram',1,29,15,31,16,'openbible:a6d9af3','contextual_location',2,'established','Genesis 29:4, 15; 30:25; 31:18','Jacob serves Laban in Haran (Paddan-aram) until departing for Canaan in Genesis 31:17-18.','curated_narrative_geography'),
('gen-39-1-50-26-joseph-egypt','Joseph and the house of Israel in Egypt',1,39,1,50,26,'openbible:af301ca','contextual_location',3,'established','Genesis 39:1; 41:41; 46:6; 47:11','Genesis 39–50 unfolds primarily in Egypt (and the eastern Nile Delta / land of Goshen), except for Jacob’s burial journey to Machpelah in Hebron (50:7-13).','curated_narrative_geography'),
('exod-1-1-12-36-egypt-goshen','Israel in Egypt and the Passover in Goshen / Rameses',2,1,1,12,36,'openbible:af301ca','contextual_location',3,'established','Exodus 1:1, 11; 8:22; 12:1, 37','Exodus 1–12 takes place in Egypt (primarily the eastern Nile Delta / Rameses / Goshen) apart from Moses’ exile in Midian (2:15–4:18).','curated_narrative_geography'),
('exod-2-15-4-18-midian','Moses in the land of Midian and at Horeb',2,2,15,4,18,'openbible:acc6d8e','contextual_location',2,'regional','Exodus 2:15; 3:1; 4:19','Exodus 2:15 and 4:19 frame Moses’ exile, encounter at the well, and return commission within the land of Midian and wilderness around Horeb.','curated_narrative_geography'),
('exod-15-22-26-marah-shur','Israel in the Wilderness of Shur at Marah',2,15,22,15,26,'openbible:ad3970d','contextual_location',2,'disputed','Exodus 15:22-23; Numbers 33:8','Exodus 15:22-23 locates the bitter waters episode at Marah in the Wilderness of Shur, preserving competing route identifications (Ain Hawarah, Bir Mara, Uyun Musa, Bitter Lakes).','curated_narrative_geography'),
('exod-16-1-36-wilderness-sin','Manna and quail in the Wilderness of Sin',2,16,1,16,36,'openbible:a0f54e4','contextual_location',2,'disputed','Exodus 16:1; Numbers 33:11','Exodus 16:1 places the entire manna narrative in the Wilderness of Sin between Elim and Sinai.','curated_narrative_geography'),
('exod-17-1-16-rephidim','Water from the rock and battle with Amalek at Rephidim',2,17,1,17,16,'openbible:a05ebb7','contextual_location',2,'disputed','Exodus 17:1, 8; Numbers 33:14','Exodus 17:1 and 17:8 locate the encampment at Rephidim along the disputed Exodus wilderness route.','curated_narrative_geography'),
('exod-19-1-40-38-mount-sinai','Encampment at Mount Sinai / Wilderness of Sinai',2,19,1,40,38,'openbible:abfba2a','contextual_location',2,'disputed','Exodus 19:1-2, 11, 20; 24:16; 34:2','Exodus 19:1-2 establishes Israel’s encampment before Mount Sinai in the Wilderness of Sinai, preserving all major scholarly and regional route identifications.','curated_narrative_geography'),
('lev-1-1-27-34-mount-sinai','Book of Leviticus — Priestly Legislation at Mount Sinai',3,1,1,27,34,'openbible:abfba2a','contextual_location',2,'disputed','Leviticus 1:1; 7:38; 25:1; 26:46; 27:34','Leviticus 1:1, 7:38, 25:1, 26:46, and 27:34 explicitly locate the revelation and proclamation of Leviticus at the Tent of Meeting on Mount Sinai in the Wilderness of Sinai.','curated_narrative_geography'),
('num-1-1-10-10-sinai-census','Israel’s Census and Camp Preparation in the Wilderness of Sinai',4,1,1,10,10,'openbible:abfba2a','contextual_location',2,'disputed','Numbers 1:1, 19; 3:14; 9:1; 10:12','Numbers 1:1 through 10:10 takes place in the Wilderness of Sinai prior to breaking camp in Numbers 10:11-12.','curated_narrative_geography'),
('num-10-11-20-21-paran-kadesh','Wilderness of Paran and Kadesh-barnea Sojourn',4,10,11,20,21,'openbible:ac2cef0','contextual_location',2,'probable','Numbers 10:12; 12:16; 13:26; 20:1, 14','Numbers 12:16, 13:26, and 20:1 center Israel’s wilderness camp at Kadesh-barnea in the Wilderness of Paran/Zin.','curated_narrative_geography'),
('num-22-1-36-13-plains-of-moab','Encampment in the Plains of Moab by the Jordan across from Jericho',4,22,1,36,13,'openbible:aa0b1d6','contextual_location',2,'established','Numbers 22:1; 26:3, 63; 33:48-50; 36:13','Numbers 22:1 and 36:13 explicitly set the Balaam narrative, second census, and Transjordan ordinances in the Plains of Moab by the Jordan across from Jericho.','curated_narrative_geography'),
('deut-1-1-34-12-moab-covenant','Book of Deuteronomy — Moses’ Farewell Addresses in the Land of Moab',5,1,1,34,12,'openbible:aa0b1d6','contextual_location',2,'established','Deuteronomy 1:1, 5; 29:1; 34:1, 8','Deuteronomy 1:1, 5 and 29:1 explicitly locate Moses’ exposition of the Torah in the land of Moab beyond the Jordan.','curated_narrative_geography'),
('deut-1-1-34-12-composition-nebo','Book of Deuteronomy — Written & Deposited in the Plains of Moab / Mount Nebo',5,1,1,34,12,'openbible:aefaa2d','composition_location',2,'established','Deuteronomy 31:9, 24-26; 32:49; 34:1','Deuteronomy 31:9, 24 records Moses writing the words of this law to the very end in the Plains of Moab before ascending Mount Nebo (Pisgah).','curated_narrative_geography'),
('ruth-1-1-18-moab','Naomi and Ruth in the Country of Moab',8,1,1,1,18,'openbible:aa0b1d6','contextual_location',2,'established','Ruth 1:1-6, 19','Ruth 1:1-18 takes place in the country of Moab and along the road returning toward Judah.','curated_narrative_geography'),
('ruth-1-19-4-22-bethlehem','Ruth and Boaz in Bethlehem of Judah',8,1,19,4,22,'openbible:a112427','contextual_location',2,'established','Ruth 1:19, 22; 2:4; 4:11','Ruth 1:19–4:22 unfolds entirely in the fields and town gate of Bethlehem in Judah.','curated_narrative_geography'),
('ezra-1-1-10-44-jerusalem-restoration','Book of Ezra — Temple Restoration & Covenant Reform in Jerusalem',15,1,1,10,44,'openbible:a15257a','contextual_location',2,'established','Ezra 1:2-5; 2:1; 3:1; 7:7-9; 10:9','Ezra records the return of the Judean exiles to Jerusalem and the rebuilding of the Second Temple and community in Jerusalem.','curated_narrative_geography'),
('ezra-1-1-10-44-babylon-origin','Book of Ezra — Departure of Exiles from Babylon',15,1,1,10,44,'openbible:a217d18','composition_location',3,'established','Ezra 1:11; 2:1; 7:6, 9; 8:1','Both waves of returnees under Zerubbabel (Ezra 2:1) and Ezra the scribe (Ezra 7:6, 9) originate from the Babylonian exile before compiling the records in Jerusalem.','curated_narrative_geography'),
('neh-1-1-2-8-susa-citadel','Nehemiah in Susa (Shushan) the Citadel as Cupbearer to Artaxerxes',16,1,1,2,8,'openbible:a033b84','contextual_location',2,'established','Nehemiah 1:1; 2:1-8','Nehemiah 1:1 explicitly locates Nehemiah in Susa (Shushan) the citadel in the twentieth year of King Artaxerxes I.','curated_narrative_geography'),
('neh-2-9-13-31-jerusalem-walls','Nehemiah’s Rebuilding of the Walls and Reforms in Jerusalem',16,2,9,13,31,'openbible:a15257a','contextual_location',2,'established','Nehemiah 2:11, 17; 6:15; 8:1; 13:6-15','From Nehemiah 2:11 through 13:31, the narrative and Nehemiah’s personal memoirs are set and composed in Jerusalem.','curated_narrative_geography'),
('esth-1-1-10-3-susa-shushan','Book of Esther — Royal Court at Susa (Shushan) the Citadel in Persia',17,1,1,10,3,'openbible:a033b84','contextual_location',2,'established','Esther 1:2, 5; 2:3, 5, 8; 3:15; 8:14-15; 9:6-18','Esther 1:2 and 9:20-32 locate the royal court events and the recording of the Purim letters in Susa (Shushan) the citadel during the reign of Ahasuerus (Xerxes I).','curated_narrative_geography'),
('job-1-1-42-17-land-of-uz','Book of Job — Dialogue in the Land of Uz',18,1,1,42,17,'openbible:a324c4d','contextual_location',3,'regional','Job 1:1; Lamentations 4:21; Jeremiah 25:20','Job 1:1 sets the entire narrative and poetic dialogue in the land of Uz (linked in Lamentations 4:21 with Edom/Teman or northern Aram/Bashan traditions).','curated_narrative_geography'),
('eccl-1-1-12-14-jerusalem','Book of Ecclesiastes — Qoheleth in Jerusalem',21,1,1,12,14,'openbible:a15257a','composition_location',2,'established','Ecclesiastes 1:1, 12, 16; 2:7, 9','Ecclesiastes 1:1 and 1:12 explicitly frame the speaker’s royal reflection and composition in Jerusalem.','curated_narrative_geography'),
('song-1-1-8-14-jerusalem','Song of Songs — Jerusalem and Royal Court Setting',22,1,1,8,14,'openbible:a15257a','contextual_location',3,'established','Song of Songs 1:5; 2:7; 3:5, 10-11; 5:8, 16; 6:4','Repeated addresses to the "daughters of Jerusalem" (1:5; 2:7; 3:5; 5:8; 8:4) and Zion (3:11) anchor the lyric collection in Jerusalem.','curated_narrative_geography'),
('isa-1-1-66-24-jerusalem-composition','Book of Isaiah — Prophetic Ministry & Composition in Jerusalem',23,1,1,66,24,'openbible:a15257a','composition_location',2,'established','Isaiah 1:1; 2:1; 6:1; 7:1-3; 36:2; 37:1-2','Isaiah 1:1 and 2:1 identify the vision of Isaiah son of Amoz concerning Judah and Jerusalem, centered on the Jerusalem Temple and royal court.','curated_narrative_geography'),
('jer-1-1-42-22-jerusalem-ministry','Book of Jeremiah (Ch. 1–42) — Prophetic Ministry & Scroll Composition in Jerusalem',24,1,1,42,22,'openbible:a15257a','composition_location',2,'established','Jeremiah 1:1-3; 7:1-2; 26:1-2; 36:1-32','Jeremiah 1–42 records Jeremiah’s proclamations and the dictation of his scroll to Baruch in Jerusalem (Jeremiah 36:4-10, 32) and nearby Anathoth.','curated_narrative_geography'),
('jer-43-1-44-30-tahpanhes-egypt','Book of Jeremiah (Ch. 43–44) — Oracles at Tahpanhes in Egypt',24,43,1,44,30,'openbible:adb008c','contextual_location',2,'established','Jeremiah 43:7-8; 44:1','Jeremiah 43:7-8 explicitly locates Jeremiah and Baruch among the Judean remnant at Tahpanhes (Daphnae / Tell Defenneh) in the eastern Nile Delta of Egypt.','curated_narrative_geography'),
('jer-45-1-52-34-jerusalem-babylon','Book of Jeremiah (Ch. 45–52) — Oracles to the Nations & Fall of Jerusalem',24,45,1,52,34,'openbible:a15257a','composition_location',3,'established','Jeremiah 45:1; 51:59-64; 52:1-30','Compiled from Jeremiah’s Jerusalem scrolls (45:1; 51:60) and sent via Seraiah to the exiles in Babylon (51:59-64).','curated_narrative_geography'),
('lam-1-1-5-22-jerusalem','Book of Lamentations — Dirges over Destroyed Jerusalem',25,1,1,5,22,'openbible:a15257a','contextual_location',2,'established','Lamentations 1:1, 7-8, 17; 2:1-15; 4:12','Lamentations mourns the 586 BC siege and destruction of Jerusalem and the Temple on Mount Zion.','curated_narrative_geography'),
('ezek-1-1-48-35-chebar-canal','Book of Ezekiel — Prophetic Residence & Composition by the Chebar (Kebar) Canal in Babylonia',26,1,1,48,35,'openbible:a3d2f0a','composition_location',2,'established','Ezekiel 1:1-3; 3:15, 23; 10:15, 20; 11:24-25; 43:3','Ezekiel 1:1-3 and 3:15 explicitly locate Ezekiel among the Judean exiles by the Chebar (Kebar) Canal at Tel-abib in the land of the Chaldeans (Babylonia), where his visions were received and written.','curated_narrative_geography'),
('ezek-8-1-11-25-jerusalem-vision','Ezekiel’s First Temple Vision in Jerusalem (while exiled in Babylonia)',26,8,1,11,25,'openbible:a15257a','contextual_location',2,'established','Ezekiel 8:1-3; 11:24-25','While sitting in his house in Babylonia (8:1), Ezekiel is brought in visions of God to Jerusalem and the inner court of the Temple (8:3) before returning in vision to the exiles in Chaldea (11:24).','curated_narrative_geography'),
('ezek-40-1-48-35-restored-temple-jerusalem','Ezekiel’s Vision of the Restored Temple and Land (Centered on Jerusalem)',26,40,1,48,35,'openbible:a15257a','audience_location',2,'established','Ezekiel 40:1-2; 43:1-7; 48:35','In the twenty-fifth year of exile in Babylonia (40:1), Ezekiel is brought in visions of God to the land of Israel and the temple mount of Jerusalem (40:2; 48:35).','curated_narrative_geography'),
('dan-1-1-7-28-babylon-court','Book of Daniel (Ch. 1–7) — Royal Court & Visions in Babylon',27,1,1,7,28,'openbible:a217d18','contextual_location',2,'established','Daniel 1:1-7; 2:12, 48-49; 4:29-30; 5:1, 30; 7:1','Daniel 1–7 is set and written in Babylon during the reigns of Nebuchadnezzar, Belshazzar, Darius, and Cyrus (Daniel 7:1 records Daniel writing down the dream on his bed in Babylon).','curated_narrative_geography'),
('dan-8-1-27-ulai-canal','Daniel’s Vision by the Ulai Canal (Eulaeus River) at Susa in Elam',27,8,1,8,27,'openbible:a7a7549','contextual_location',2,'established','Daniel 8:2, 16','Daniel 8:2 and 8:16 explicitly locate Daniel’s vision of the ram and the goat beside the Ulai Canal (אוּלַי / Eulaeus / Karkheh-Shaur waterway) at Susa.','curated_narrative_geography'),
('dan-8-1-27-susa-composition','Daniel 8 — Susa (Shushan) the Citadel in the Province of Elam (Setting & Composition)',27,8,1,8,27,'openbible:a033b84','composition_location',2,'established','Daniel 8:2, 27','Daniel 8:2 and 8:27 locate Daniel at Susa (Shushan) the citadel in the province of Elam, where he saw the vision and afterward went about the king’s business.','curated_narrative_geography'),
('dan-9-1-27-babylon-prayer','Daniel 9 — Prayer and Seventy-Weeks Revelation in Babylon',27,9,1,9,27,'openbible:a217d18','composition_location',2,'established','Daniel 9:1-2, 20-21','Daniel 9:1-2 locates Daniel in the realm of the Chaldeans (Babylon) in the first year of Darius, studying Jeremiah’s scroll and interceding for Jerusalem.','curated_narrative_geography'),
('dan-10-1-12-13-tigris-river','Daniel 10–12 — Final Vision on the Bank of the Great River Tigris (Hiddekel)',27,10,1,12,13,'openbible:a38ebfd','contextual_location',2,'established','Daniel 10:4; 12:5-6','Daniel 10:4 and 12:5 explicitly locate the entire final revelation (chapters 10–12) on the bank of the great river, the Tigris (Hiddekel).','curated_narrative_geography'),
('dan-10-1-12-13-babylon-composition','Daniel 10–12 — Written in Babylonia / Mesopotamia (Third Year of Cyrus)',27,10,1,12,13,'openbible:a217d18','composition_location',3,'established','Daniel 10:1; 12:4, 9','Revealed and sealed in a scroll (Daniel 12:4) in Mesopotamia/Babylonia in the third year of Cyrus king of Persia (10:1).','curated_narrative_geography'),
('hos-1-1-14-9-samaria-israel','Book of Hosea — Prophetic Ministry to Samaria & Northern Israel',28,1,1,14,9,'openbible:a041bb3','audience_location',2,'established','Hosea 1:1, 4; 7:1; 8:5-6; 10:5, 7; 13:16','Hosea prophesies in and to the Northern Kingdom of Israel centered at its royal capital Samaria.','curated_narrative_geography'),
('joel-1-1-3-21-jerusalem-zion','Book of Joel — Prophetic Liturgy in Jerusalem (Mount Zion)',29,1,1,3,21,'openbible:a15257a','composition_location',2,'established','Joel 1:14; 2:1, 15, 23, 32; 3:1, 16-21','Joel is set at the Temple and Mount Zion in Jerusalem, calling the priests and inhabitants of Judah and Jerusalem to solemn assembly.','curated_narrative_geography'),
('amos-1-1-9-15-bethel-audience','Book of Amos — Prophetic Confrontation at Bethel & Samaria',30,1,1,9,15,'openbible:a64f355','audience_location',2,'established','Amos 3:14; 4:4; 5:5-6; 7:10-13','Amos delivers his primary indictment at the king’s sanctuary and temple of the kingdom at Bethel in Northern Israel (Amos 7:10-13).','curated_narrative_geography'),
('amos-1-1-9-15-tekoa-composition','Book of Amos — Authored by Amos of Tekoa in Judah',30,1,1,9,15,'openbible:a2e3aa0','composition_location',2,'established','Amos 1:1; 7:12','Amos 1:1 identifies the prophet’s origin and Judean home base as Tekoa (Khirbet Teku’a, south of Bethlehem).','curated_narrative_geography'),
('obad-1-1-21-edom-audience','Book of Obadiah — Oracle Concerning Edom (Mount Seir)',31,1,1,1,21,'openbible:a2735ff','audience_location',2,'established','Obadiah 1, 8-9, 18-21','Obadiah 1 explicitly directs the vision against Edom and Mount Seir.','curated_narrative_geography'),
('obad-1-1-21-jerusalem-composition','Book of Obadiah — Composed Concerning Jerusalem’s Fall and Restoration',31,1,1,1,21,'openbible:a15257a','composition_location',3,'established','Obadiah 11-17, 20-21','Composed in Judah/Jerusalem reflecting on Edom’s hostility on the day strangers entered the gates of Jerusalem (v. 11) and promising deliverance on Mount Zion (v. 17, 21).','curated_narrative_geography'),
('jonah-1-1-2-10-joppa-sea','Book of Jonah (Ch. 1–2) — Flight from Joppa onto the Mediterranean Sea',32,1,1,2,10,'openbible:ae023a9','contextual_location',2,'established','Jonah 1:3-4','Jonah 1:3 locates Jonah’s embarkation at the port of Joppa (Jaffa) into the Mediterranean Sea.','curated_narrative_geography'),
('jonah-3-1-4-11-nineveh','Book of Jonah (Ch. 3–4) — Jonah’s Preaching and Vigil at Nineveh',32,3,1,4,11,'openbible:a70fd5d','contextual_location',2,'established','Jonah 3:2-5; 4:5, 11','Jonah 3:2-5 and 4:5 explicitly set chapters 3–4 in and just east of the great Assyrian city of Nineveh.','curated_narrative_geography'),
('mic-1-1-7-20-jerusalem-samaria','Book of Micah — Prophetic Word Concerning Samaria and Jerusalem',33,1,1,7,20,'openbible:a15257a','audience_location',2,'established','Micah 1:1, 5, 9; 3:10, 12; 4:1-2','Micah 1:1 and Jeremiah 26:18 anchor Micah of Moresheth’s prophetic ministry and audience in Jerusalem and Judah (alongside Samaria).','curated_narrative_geography'),
('nah-1-1-3-19-nineveh-oracle','Book of Nahum — Oracle Concerning Nineveh (Assyria)',34,1,1,3,19,'openbible:a70fd5d','audience_location',2,'established','Nahum 1:1; 2:8; 3:7, 18','Nahum 1:1 explicitly titles the book "An oracle concerning Nineveh," the capital of the Neo-Assyrian Empire.','curated_narrative_geography'),
('nah-1-1-3-19-judah-composition','Book of Nahum — Composed in Judah / Jerusalem',34,1,1,3,19,'openbible:a15257a','composition_location',3,'probable','Nahum 1:15','Nahum 1:15 addresses Judah ("Keep your feasts, O Judah; fulfill your vows") from within the Southern Kingdom centered on Jerusalem.','curated_narrative_geography'),
('hab-1-1-3-19-jerusalem-judah','Book of Habakkuk — Watchtower Oracle & Temple Liturgy in Jerusalem',35,1,1,3,19,'openbible:a15257a','composition_location',2,'established','Habakkuk 1:6; 2:1, 20; 3:19','Composed in Jerusalem/Judah on the eve of the Neo-Babylonian invasion, concluding with a liturgical psalm for the Jerusalem Temple choir (3:19).','curated_narrative_geography'),
('zeph-1-1-3-20-jerusalem','Book of Zephaniah — Prophetic Ministry in Josiah’s Jerusalem',36,1,1,3,20,'openbible:a15257a','composition_location',2,'established','Zephaniah 1:1, 4, 10-12; 3:14-17','Zephaniah 1:4, 10-12 names specific quarters of Jerusalem (Fish Gate, Second Quarter, Mortar) as the immediate setting and audience of his ministry.','curated_narrative_geography'),
('hag-1-1-2-23-jerusalem-temple','Book of Haggai — Oracles at the Second Temple Site in Jerusalem',37,1,1,2,23,'openbible:a15257a','contextual_location',2,'established','Haggai 1:1-4, 14; 2:1-9; Ezra 5:1-2','Delivered in Jerusalem in 520 BC (second year of Darius I) to Zerubbabel, Joshua, and the remnant rebuilding the Temple.','curated_narrative_geography'),
('zech-1-1-14-21-jerusalem','Book of Zechariah — Post-Exilic Visions and Oracles in Jerusalem',38,1,1,14,21,'openbible:a15257a','composition_location',2,'established','Zechariah 1:1, 16; 2:1-12; 8:3; 14:1-21; Ezra 5:1-2','Zechariah prophesies and writes in post-exilic Jerusalem alongside Haggai during the rebuilding of the Second Temple.','curated_narrative_geography'),
('mal-1-1-4-6-jerusalem','Book of Malachi — Covenant Disputation at the Jerusalem Temple',39,1,1,4,6,'openbible:a15257a','composition_location',2,'established','Malachi 1:1, 10; 2:11; 3:1, 4, 10','Malachi addresses the priests and community serving at the altar and storehouse of the Second Temple in Jerusalem (Persian Yehud).','curated_narrative_geography'),
('matt-1-1-28-20-composition-antioch','Gospel of Matthew — Scholarly Composition & Audience Provenance (Syrian Antioch / Judea)',40,1,1,28,20,'openbible:ae41ab4','composition_location',4,'probable','Matthew 4:24; Ignatius of Antioch; Acts 11:19-26','Early patristic reception (Ignatius of Antioch, Didache) and modern New Testament scholarship most commonly locate the composition of Matthew in Syrian Antioch (or Galilee/Judea) for a Greek-speaking Jewish-Christian community.','curated_narrative_geography'),
('matt-5-1-7-29-sermon-mount-galilee','Sermon on the Mount in Galilee (near Capernaum / Sea of Galilee)',40,5,1,7,29,'openbible:af2161c','contextual_location',2,'established','Matthew 4:23-25; 5:1; 8:1, 5','Matthew 4:23–5:1 and 8:1, 5 frame the Sermon on the Mount on the hillsides overlooking the Sea of Galilee immediately adjacent to Capernaum.','curated_narrative_geography'),
('mark-1-1-16-20-composition-rome','Gospel of Mark — Composition & Audience Provenance in Rome',41,1,1,16,20,'openbible:afc8e7a','composition_location',4,'probable','1 Peter 5:13; Mark 15:21; Papias (Eusebius, Hist. eccl. 3.39.15); Irenaeus (Adv. Haer. 3.1.1)','Early patristic testimony (Papias, Irenaeus, Clement of Alexandria) and Latinisms in the text connect Mark’s Gospel with Peter’s ministry and the Christian community in Rome.','curated_narrative_geography'),
('luke-1-1-24-53-composition-caesarea-rome','Gospel of Luke — Composition Provenance (Caesarea / Rome / Achaia)',42,1,1,24,53,'openbible:a58735e','composition_location',4,'probable','Luke 1:1-4; Acts 24:27; 27:1; 28:16, 30','Luke compiled his two-volume work for Theophilus drawing on eyewitness traditions gathered during Paul’s two-year imprisonment at Caesarea Maritima (Acts 24:27) and subsequent stay in Rome (Acts 28:30).','curated_narrative_geography'),
('john-4-5-42-sychar-samaria','Jesus and the Samaritan woman at Jacob’s well near Sychar in Samaria',43,4,5,4,42,'openbible:a27b472','contextual_location',2,'probable','John 4:4-6','John 4:4-6 explicitly establishes the narrative setting at Jacob’s well near the Samaritan town of Sychar (identified with modern Askar or Tell Balatah/Shechem) for the entire dialogue and townspeople encounter through verse 42.','curated_narrative_geography'),
('john-13-1-17-26-jerusalem-upper-room','Jesus’ Farewell Discourse and High Priestly Prayer in Jerusalem',43,13,1,17,26,'openbible:a15257a','contextual_location',2,'established','John 12:12; 13:1; 18:1','John 13–17 takes place in Jerusalem on the night before the crucifixion prior to crossing the Kidron Valley in John 18:1.','curated_narrative_geography'),
('john-1-1-21-25-composition-ephesus','Gospel of John — Composition & Publication at Ephesus in Roman Asia',43,1,1,21,25,'openbible:a5feb15','composition_location',4,'established','John 21:24; Irenaeus (Adv. Haer. 3.1.1); Polycrates of Ephesus (Eusebius, Hist. eccl. 5.24.2-3)','Second-century witnesses from Asia Minor (Irenaeus, Polycrates of Ephesus) and modern scholarship identify Ephesus as the place where the Fourth Gospel was written and published.','curated_narrative_geography'),
('acts-1-1-7-60-jerusalem-early-church','Early Jerusalem Church, Pentecost, and Stephen’s Defense in Jerusalem',44,1,1,7,60,'openbible:a15257a','contextual_location',2,'established','Acts 1:4, 12; 2:5; 4:5; 6:7; 8:1','Acts 1–7 takes place entirely in Jerusalem (Mount of Olives, Upper Room, Temple courts, and Sanhedrin council chamber).','curated_narrative_geography'),
('acts-17-16-34-athens-areopagus','Paul’s ministry and Areopagus speech in Athens',44,17,16,17,34,'openbible:a1fe6e7','contextual_location',2,'established','Acts 17:15-16, 19, 22; 18:1','Acts 17:15-16 and 17:19-22 establish Athens and the Areopagus as the setting of Paul’s reasoning and address until he departs Athens for Corinth in Acts 18:1.','curated_narrative_geography'),
('acts-1-1-28-31-composition-rome','Acts of the Apostles — Composition Provenance in Rome',44,1,1,28,31,'openbible:afc8e7a','composition_location',4,'probable','Acts 1:1; 28:16, 30-31','Acts culminates with Luke accompanying Paul to Rome during his two-year house arrest (Acts 28:16, 30-31), where the book is traditionally and critically dated.','curated_narrative_geography'),
('rom-1-1-16-27-audience-rome','Epistle to the Romans — Written To the Church in Rome',45,1,1,16,27,'openbible:afc8e7a','audience_location',2,'established','Romans 1:7, 15','Romans 1:7 and 1:15 explicitly address the epistle "to all those in Rome who are loved by God and called to be saints."','curated_narrative_geography'),
('rom-1-1-16-27-composition-corinth','Epistle to the Romans — Written by Paul from Corinth (Cenchreae)',45,1,1,16,27,'openbible:a6f437a','composition_location',2,'established','Romans 16:1, 22-23; 1 Corinthians 1:14; Acts 20:2-3','Paul commends Phoebe, a deacon of the church at Cenchreae (Corinth’s eastern port, Romans 16:1), and sends greetings from his host Gaius and city treasurer Erastus in Corinth (16:23; c. AD 57).','curated_narrative_geography'),
('1cor-1-1-16-24-audience-corinth','First Epistle to the Corinthians — Written To the Church at Corinth',46,1,1,16,24,'openbible:a6f437a','audience_location',2,'established','1 Corinthians 1:2','1 Corinthians 1:2 explicitly addresses "the church of God that is in Corinth" in the Roman province of Achaia.','curated_narrative_geography'),
('1cor-1-1-16-24-composition-ephesus','First Epistle to the Corinthians — Written by Paul from Ephesus',46,1,1,16,24,'openbible:a5feb15','composition_location',2,'established','1 Corinthians 16:8, 19; Acts 19:1, 22','1 Corinthians 16:8 and 16:19 explicitly state that Paul is writing from Ephesus ("I will stay in Ephesus until Pentecost... The churches of Asia send you greetings").','curated_narrative_geography'),
('2cor-1-1-13-14-audience-corinth','Second Epistle to the Corinthians — Written To the Church at Corinth & Achaia',47,1,1,13,14,'openbible:a6f437a','audience_location',2,'established','2 Corinthians 1:1, 23; 6:11','2 Corinthians 1:1 explicitly addresses "the church of God that is at Corinth, with all the saints who are in the whole of Achaia."','curated_narrative_geography'),
('2cor-1-1-13-14-composition-macedonia','Second Epistle to the Corinthians — Written by Paul from Macedonia',47,1,1,13,14,'openbible:a69e1b8','composition_location',2,'established','2 Corinthians 2:13; 7:5-7; 8:1; 9:2-4; Acts 20:1-2','2 Corinthians 2:13, 7:5, 8:1, and 9:2-4 establish that Paul wrote the epistle from Macedonia (Philippi/Thessalonica) after meeting Titus on his way toward Corinth.','curated_narrative_geography'),
('gal-1-1-6-18-audience-galatia','Epistle to the Galatians — Written To the Churches of Galatia',48,1,1,6,18,'openbible:a0f440a','audience_location',2,'established','Galatians 1:2; 3:1; Acts 13:14–14:23; 16:6','Galatians 1:2 and 3:1 explicitly address "the churches of Galatia" in Asia Minor (Pisidian Antioch, Iconium, Lystra, Derbe, and central Anatolia).','curated_narrative_geography'),
('gal-1-1-6-18-composition-antioch','Epistle to the Galatians — Written by Paul (Syrian Antioch / Ephesus Provenance)',48,1,1,6,18,'openbible:ae41ab4','composition_location',3,'probable','Galatians 2:11-14; Acts 14:26-28; 18:22-23','Written by Paul either from his sending church at Syrian Antioch following the First Missionary Journey (Galatians 2:11; Acts 14:26-28) or from Ephesus/Corinth during the Third Missionary Journey.','curated_narrative_geography'),
('eph-1-1-6-24-audience-ephesus','Epistle to the Ephesians — Written To the Church at Ephesus (and Roman Asia)',49,1,1,6,24,'openbible:a5feb15','audience_location',2,'established','Ephesians 1:1; 6:21-22; Acts 19:1-10','Ephesians 1:1 addresses the saints who are in Ephesus (and circular congregations across the Roman province of Asia, delivered by Tychicus — 6:21-22).','curated_narrative_geography'),
('eph-1-1-6-24-composition-rome','Epistle to the Ephesians — Written by Paul in Imprisonment (Rome)',49,1,1,6,24,'openbible:afc8e7a','composition_location',2,'probable','Ephesians 3:1; 4:1; 6:20-21; Acts 28:16, 30','Paul writes as "an ambassador in chains" (Ephesians 3:1; 4:1; 6:20), traditionally from his Roman imprisonment (c. AD 60–62; alternative proposals: Ephesus or Caesarea) and sends the letter with Tychicus.','curated_narrative_geography'),
('phil-1-1-4-23-audience-philippi','Epistle to the Philippians — Written To the Church at Philippi in Macedonia',50,1,1,4,23,'openbible:a49e1d0','audience_location',2,'established','Philippians 1:1; 4:15; Acts 16:12','Philippians 1:1 and 4:15 explicitly address the saints, overseers, and deacons at Philippi, a Roman colony and leading city of the district of Macedonia.','curated_narrative_geography'),
('phil-1-1-4-23-composition-rome','Epistle to the Philippians — Written by Paul in Imprisonment (Rome)',50,1,1,4,23,'openbible:afc8e7a','composition_location',2,'probable','Philippians 1:13; 4:22; Acts 28:16, 30','Philippians 1:13 ("throughout the whole imperial guard / praetorium") and 4:22 ("those of Caesar’s household") point to Paul’s imprisonment in Rome (c. AD 60–62; alternative proposals: Ephesus or Caesarea).','curated_narrative_geography'),
('col-1-1-4-18-audience-colossae','Epistle to the Colossians — Written To the Church at Colossae (Colossia)',51,1,1,4,18,'openbible:a4e5a69','audience_location',2,'established','Colossians 1:2; 2:1; 4:13, 16','Colossians 1:2 explicitly addresses "the saints and faithful brothers in Christ at Colossae" (Κολοσσαί / Colossia) in the Lycus Valley of Phrygia (Roman Asia), alongside neighboring Laodicea and Hierapolis (4:13, 16).','curated_narrative_geography'),
('col-1-1-4-18-composition-rome','Epistle to the Colossians — Written by Paul in Imprisonment (Rome)',51,1,1,4,18,'openbible:afc8e7a','composition_location',2,'probable','Colossians 4:3, 7-10, 18; Philemon 1, 22-24; Acts 28:16, 30','Written by Paul in chains ("Remember my chains" — Colossians 4:3, 10, 18), traditionally from his imprisonment in Rome (c. AD 60–62; alternative proposals: Ephesus or Caesarea) and carried to Colossae by Tychicus and Onesimus (4:7-9).','curated_narrative_geography'),
('1thess-1-1-5-28-audience-thessalonica','First Epistle to the Thessalonians — Written To the Church at Thessalonica',52,1,1,5,28,'openbible:afa9d8e','audience_location',2,'established','1 Thessalonians 1:1; 2:1-2; Acts 17:1','1 Thessalonians 1:1 explicitly addresses "the church of the Thessalonians in God the Father and the Lord Jesus Christ" in Macedonia.','curated_narrative_geography'),
('1thess-1-1-5-28-composition-corinth','First Epistle to the Thessalonians — Written by Paul from Corinth',52,1,1,5,28,'openbible:a6f437a','composition_location',2,'established','1 Thessalonians 3:1-6; Acts 18:1, 5','Acts 18:1, 5 and 1 Thessalonians 3:1-6 show that Paul wrote 1 Thessalonians from Corinth shortly after Silas and Timothy rejoined him from Macedonia (c. AD 50–51).','curated_narrative_geography'),
('2thess-1-1-3-18-audience-thessalonica','Second Epistle to the Thessalonians — Written To the Church at Thessalonica',53,1,1,3,18,'openbible:afa9d8e','audience_location',2,'established','2 Thessalonians 1:1','2 Thessalonians 1:1 explicitly addresses "the church of the Thessalonians in God our Father and the Lord Jesus Christ."','curated_narrative_geography'),
('2thess-1-1-3-18-composition-corinth','Second Epistle to the Thessalonians — Written by Paul from Corinth',53,1,1,3,18,'openbible:a6f437a','composition_location',2,'established','2 Thessalonians 1:1; Acts 18:1, 5, 11','Written by Paul, Silvanus, and Timothy from Corinth during their eighteen-month ministry in Achaia (Acts 18:5, 11; c. AD 51).','curated_narrative_geography'),
('1tim-1-1-6-21-audience-ephesus','First Epistle to Timothy — Addressed to Timothy at Ephesus',54,1,1,6,21,'openbible:a5feb15','audience_location',2,'established','1 Timothy 1:3','1 Timothy 1:3 explicitly states that Paul urged Timothy "to remain at Ephesus" to shepherd the congregation there.','curated_narrative_geography'),
('1tim-1-1-6-21-composition-macedonia','First Epistle to Timothy — Written by Paul from Macedonia',54,1,1,6,21,'openbible:a69e1b8','composition_location',2,'established','1 Timothy 1:3; 3:14','1 Timothy 1:3 records that Paul wrote the epistle after departing Ephesus for Macedonia ("As I urged you when I was going to Macedonia, remain at Ephesus").','curated_narrative_geography'),
('2tim-1-1-4-22-audience-ephesus','Second Epistle to Timothy — Addressed to Timothy at Ephesus',55,1,1,4,22,'openbible:a5feb15','audience_location',2,'established','2 Timothy 1:18; 4:12, 19; 1 Timothy 1:3','2 Timothy 1:18 and 4:12, 19 locate Timothy with the Ephesian household of Onesiphorus and Prisca and Aquila in Ephesus.','curated_narrative_geography'),
('2tim-1-1-4-22-composition-rome','Second Epistle to Timothy — Written by Paul from Imprisonment in Rome',55,1,1,4,22,'openbible:afc8e7a','composition_location',2,'established','2 Timothy 1:16-17; 2:9; 4:6-8, 16-17, 21','2 Timothy 1:17 explicitly states that Onesiphorus searched for Paul and found him "when he arrived in Rome," where Paul awaits the conclusion of his trial.','curated_narrative_geography'),
('titus-1-1-3-15-audience-crete','Epistle to Titus — Addressed to Titus on the Island of Crete',56,1,1,3,15,'openbible:a26aa94','audience_location',2,'established','Titus 1:5, 12','Titus 1:5 explicitly states: "This is why I left you in Crete, so that you might put what remained into order, and appoint elders in every town."','curated_narrative_geography'),
('titus-1-1-3-15-composition-nicopolis','Epistle to Titus — Written by Paul En Route to Nicopolis',56,1,1,3,15,'openbible:af43cde','composition_location',2,'probable','Titus 3:12','Titus 3:12 instructs Titus: "Do your best to come to me at Nicopolis, for I have decided to spend the winter there."','curated_narrative_geography'),
('phlm-1-1-25-audience-colossae','Epistle to Philemon — Addressed to Philemon’s House Church at Colossae',57,1,1,1,25,'openbible:a4e5a69','audience_location',2,'established','Philemon 1-2, 10-12; Colossians 4:9, 17','Colossians 4:9 ("Onesimus, who is one of you") and 4:17 ("say to Archippus") connect Philemon, Apphia, Archippus, and Onesimus directly to Colossae.','curated_narrative_geography'),
('phlm-1-1-25-composition-rome','Epistle to Philemon — Written by Paul in Imprisonment (Rome)',57,1,1,1,25,'openbible:afc8e7a','composition_location',2,'probable','Philemon 1, 9-10, 22-24; Colossians 4:7-14','Written simultaneously with Colossians during Paul’s imprisonment (traditionally Rome, c. AD 60–62; alternative proposal: Ephesus).','curated_narrative_geography'),
('heb-1-1-13-25-audience-rome-italy','Epistle to the Hebrews — Italian / Roman Congregation Circle',58,1,1,13,25,'openbible:afc8e7a','audience_location',3,'probable','Hebrews 13:23-24; 1 Clement (Rome, c. AD 96)','Hebrews 13:24 ("Those who come from Italy send you greetings") and its earliest attestation in 1 Clement at Rome connect the epistle’s recipients and senders with Italy/Rome.','curated_narrative_geography'),
('jas-1-1-5-20-composition-jerusalem','Epistle of James — Written from Jerusalem to the Twelve Tribes in the Dispersion',59,1,1,5,20,'openbible:a15257a','composition_location',2,'established','James 1:1; Acts 12:17; 15:13; 21:18; Galatians 1:19; 2:9','Written by James (the Lord’s brother and leader of the Jerusalem church) from Jerusalem to Jewish-Christian congregations in the Dispersion (James 1:1).','curated_narrative_geography'),
('1pet-1-1-5-14-audience-asia-minor','First Epistle of Peter — Written To the Churches of Asia Minor (Pontus, Galatia, Cappadocia, Asia, Bithynia)',60,1,1,5,14,'openbible:a197f19','audience_location',2,'established','1 Peter 1:1','1 Peter 1:1 explicitly addresses "the elect exiles of the Dispersion in Pontus, Galatia, Cappadocia, Asia, and Bithynia" across Roman Asia Minor.','curated_narrative_geography'),
('1pet-1-1-5-14-composition-rome','First Epistle of Peter — Written from Rome ("Babylon")',60,1,1,5,14,'openbible:afc8e7a','composition_location',2,'established','1 Peter 5:12-13; Eusebius (Hist. eccl. 2.15.2)','1 Peter 5:13 sends greetings from "she who is at Babylon" alongside Mark—universally understood in early patristic and modern critical scholarship as the church in Rome.','curated_narrative_geography'),
('2pet-1-1-3-18-audience-asia-minor','Second Epistle of Peter — Written To the Churches of Asia Minor',61,1,1,3,18,'openbible:a197f19','audience_location',2,'probable','2 Peter 3:1; 1 Peter 1:1','2 Peter 3:1 ("This is now the second letter that I am writing to you") identifies the recipients with the Asia Minor congregations addressed in 1 Peter 1:1.','curated_narrative_geography'),
('2pet-1-1-3-18-composition-rome','Second Epistle of Peter — Written from Rome Prior to Martyrdom',61,1,1,3,18,'openbible:afc8e7a','composition_location',3,'probable','2 Peter 1:13-15','Framed as Peter’s testament shortly before the putting off of his body (2 Peter 1:14), associated with his martyrdom in Rome.','curated_narrative_geography'),
('1john-1-1-5-21-ephesus','First Epistle of John — Written & Circulated in Ephesus (Roman Asia)',62,1,1,5,21,'openbible:a5feb15','composition_location',2,'probable','Irenaeus (Adv. Haer. 3.3.4); Eusebius (Hist. eccl. 3.23)','Composed within the Johannine community network centered at Ephesus in the Roman province of Asia.','curated_narrative_geography'),
('2john-1-1-13-ephesus','Second Epistle of John — Written from Ephesus in Roman Asia',63,1,1,1,13,'openbible:a5feb15','composition_location',2,'probable','2 John 1, 12; Irenaeus (Adv. Haer. 3.16.8)','Written by the Elder within the Johannine circle centered at Ephesus in Roman Asia.','curated_narrative_geography'),
('3john-1-1-15-ephesus','Third Epistle of John — Written from Ephesus in Roman Asia',64,1,1,1,15,'openbible:a5feb15','composition_location',2,'probable','3 John 1, 9-14','Written by the Elder to Gaius within the Johannine network of churches around Ephesus in Roman Asia.','curated_narrative_geography'),
('jude-1-1-25-jerusalem-judea','Epistle of Jude — Judean / Jerusalem Apostolic Provenance',65,1,1,1,25,'openbible:a15257a','composition_location',3,'probable','Jude 1, 17; Matthew 13:55; Acts 1:14','Written by Jude, servant of Jesus Christ and brother of James (leader of the Jerusalem church).','curated_narrative_geography'),
('rev-1-1-3-22-composition-patmos','Book of Revelation (Ch. 1–3) — Written by John on the Island of Patmos',66,1,1,3,22,'openbible:a8f60f3','composition_location',2,'established','Revelation 1:9-11','Revelation 1:9-11 explicitly states that John was on the island called Patmos in the Aegean Sea when commanded to write in a scroll to the seven churches of Asia.','curated_narrative_geography'),
('rev-1-1-20-audience-asia','Revelation 1 — Addressed to the Seven Churches in the Province of Asia',66,1,1,1,20,'openbible:a197f19','audience_location',2,'established','Revelation 1:4, 11','Revelation 1:4 and 1:11 address the seven churches in the Roman province of Asia (Ephesus, Smyrna, Pergamum, Thyatira, Sardis, Philadelphia, Laodicea).','curated_narrative_geography'),
('rev-2-1-7-audience-ephesus','Revelation 2:1–7 — Message to the Church in Ephesus',66,2,1,2,7,'openbible:a5feb15','audience_location',2,'established','Revelation 2:1','Revelation 2:1 explicitly addresses the angel of the church in Ephesus.','curated_narrative_geography'),
('rev-2-8-11-audience-smyrna','Revelation 2:8–11 — Message to the Church in Smyrna',66,2,8,2,11,'openbible:a2e65fb','audience_location',2,'established','Revelation 2:8','Revelation 2:8 explicitly addresses the angel of the church in Smyrna (modern Izmir).','curated_narrative_geography'),
('rev-2-12-17-audience-pergamos','Revelation 2:12–17 — Message to the Church in Pergamum',66,2,12,2,17,'openbible:a75d2c1','audience_location',2,'established','Revelation 2:12','Revelation 2:12 explicitly addresses the angel of the church in Pergamum.','curated_narrative_geography'),
('rev-2-18-29-audience-thyatira','Revelation 2:18–29 — Message to the Church in Thyatira',66,2,18,2,29,'openbible:a94b661','audience_location',2,'established','Revelation 2:18','Revelation 2:18 explicitly addresses the angel of the church in Thyatira.','curated_narrative_geography'),
('rev-3-1-6-audience-sardis','Revelation 3:1–6 — Message to the Church in Sardis',66,3,1,3,6,'openbible:aab4a5f','audience_location',2,'established','Revelation 3:1','Revelation 3:1 explicitly addresses the angel of the church in Sardis.','curated_narrative_geography'),
('rev-3-7-13-audience-philadelphia','Revelation 3:7–13 — Message to the Church in Philadelphia',66,3,7,3,13,'openbible:a1c7cc1','audience_location',2,'established','Revelation 3:7','Revelation 3:7 explicitly addresses the angel of the church in Philadelphia.','curated_narrative_geography'),
('rev-3-14-22-audience-laodicea','Revelation 3:14–22 — Message to the Church in Laodicea',66,3,14,3,22,'openbible:a83fb1e','audience_location',2,'established','Revelation 3:14','Revelation 3:14 explicitly addresses the angel of the church in Laodicea in the Lycus Valley.','curated_narrative_geography'),
('rev-4-1-5-14-heavenly-throne','Heavenly throne-room vision',66,4,1,5,14,'symbolic:heavenly-throne','uncertain_location',2,'symbolic_non_physical','Revelation 4:1-2','Revelation 4:1-2 explicitly frames the vision in heaven rather than at a physical terrestrial coordinate.','curated_narrative_geography'),
('rev-21-1-22-5-new-jerusalem','Vision of the New Heaven, New Earth, and New Jerusalem',66,21,1,22,5,'symbolic:new-jerusalem','uncertain_location',2,'symbolic_non_physical','Revelation 21:1-2, 10','Revelation 21:1-2 describes the eschatological New Jerusalem descending out of heaven from God in a new heaven and new earth; no physical terrestrial GPS coordinate is fabricated.','curated_narrative_geography')
) as v(
  passage_key, title, book, start_chapter, start_verse, end_chapter, end_verse,
  place_key, relationship_type, resolution_tier, confidence_level,
  evidence_refs, evidence_explanation, source_key
)
left join public.places pl on pl.place_key = v.place_key
join public.geography_sources s on s.source_key = v.source_key
on conflict (passage_key) do update set
  title = excluded.title,
  book = excluded.book,
  start_chapter = excluded.start_chapter,
  start_verse = excluded.start_verse,
  end_chapter = excluded.end_chapter,
  end_verse = excluded.end_verse,
  place_id = excluded.place_id,
  relationship_type = excluded.relationship_type,
  resolution_tier = excluded.resolution_tier,
  confidence_level = excluded.confidence_level,
  evidence_refs = excluded.evidence_refs,
  evidence_explanation = excluded.evidence_explanation;

-- Ensure Daniel 8:2 & 8:16 Ulai and Susa direct verse_geography rows are event_location (Tier 1)
update public.verse_geography vg
set relationship_type = 'event_location', resolution_tier = 1
from public.verses vr, public.places pl
where vg.verse_id = vr.id and vg.place_id = pl.id
  and vr.book = 27 and vr.chapter = 8
  and pl.place_key in ('openbible:a7a7549', 'openbible:a033b84');

-- Replace public.get_verse_geography with chronological context, period-specific ancient names,
-- composition/audience location resolution, and era_gazetteer
create or replace function public.get_verse_geography(
  p_book integer,
  p_chapter integer,
  p_verse integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '5s'
as $rpc$
declare
  vid integer;
  v_millennium smallint;
  lo_year integer;
  hi_year integer;
  era_key text;
  era_label text;
  date_label text;
  chron_json jsonb;
  gazetteer_json jsonb;
  locations_json jsonb;
  passages_json jsonb;
  sources_json jsonb;
  bounds_json jsonb;
  res_status text;
  top_tier smallint;
  has_physical boolean;
  has_non_physical boolean;
  response jsonb;
begin
  if p_book is null or p_chapter is null or p_verse is null
     or p_book not between 1 and 66
     or p_chapter not between 1 and 150
     or p_verse not between 0 and 176 then
    return jsonb_build_object('schema_version', 1, 'status', 'invalid_reference');
  end if;

  select v.id, v.millennium into vid, v_millennium
  from public.verses v
  where v.book = p_book::smallint and v.chapter = p_chapter::smallint and v.verse_nr = p_verse::smallint;

  if vid is null then
    return jsonb_build_object('schema_version', 1, 'status', 'passage_not_found');
  end if;

  -- 1. Resolve chronological time of the verse from chronology_assertions or scholarly book range
  select
    min(a.earliest_year),
    max(a.latest_year)
  into lo_year, hi_year
  from public.chronology_assignment_assertions aa
  join public.chronology_assertions a on a.id = aa.assertion_id
  join public.chronology_active_runs ar on ar.run_id = aa.run_id
  where aa.verse_id = vid
    and a.axis <> 'mentioned_event'
    and a.earliest_year is not null;

  if lo_year is null then
    if p_book = 1 then lo_year := -2000; hi_year := -1800;
    elsif p_book in (2, 3, 4, 5, 6, 7, 18) then lo_year := -1445; hi_year := -1050;
    elsif p_book in (8, 9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34, 35, 36) then lo_year := -1010; hi_year := -586;
    elsif p_book = 26 then lo_year := -592; hi_year := -570;
    elsif p_book = 27 and p_chapter = 8 then lo_year := -550; hi_year := -550;
    elsif p_book = 27 then lo_year := -604; hi_year := -535;
    elsif p_book = 17 then lo_year := -482; hi_year := -472;
    elsif p_book in (15, 16, 37, 38, 39) then lo_year := -538; hi_year := -430;
    elsif p_book in (40, 41, 42, 43) then lo_year := -4; hi_year := 33;
    elsif p_book = 44 then lo_year := 30; hi_year := 62;
    elsif p_book in (52, 53) then lo_year := 50; hi_year := 51;
    elsif p_book in (45, 46, 47, 48) then lo_year := 53; hi_year := 57;
    elsif p_book in (49, 50, 51, 57) then lo_year := 60; hi_year := 62;
    elsif p_book in (54, 55, 56, 58, 59, 60, 61, 65) then lo_year := 48; hi_year := 67;
    else lo_year := 85; hi_year := 96;
    end if;
  end if;

  if p_book >= 40 or hi_year >= -10 then
    era_key := 'roman_new_testament';
    era_label := 'Early Roman Empire & Apostolic Age (1st Century AD)';
  elsif p_book in (15, 16, 17, 26, 27, 37, 38, 39) or (hi_year between -586 and -332) then
    era_key := 'exile_persian';
    era_label := 'Babylonian Exile & Achaemenid Persian Period (6th–5th Century BC)';
  elsif p_book = 1 or (hi_year <= -1550) then
    era_key := 'primeval_patriarchal';
    era_label := 'Primeval & Patriarchal Period (Middle Bronze Age)';
  elsif p_book in (2, 3, 4, 5, 6, 7) or (hi_year between -1549 and -1040) then
    era_key := 'exodus_conquest_judges';
    era_label := 'Exodus, Wilderness, Conquest & Judges (Late Bronze / Iron Age I)';
  else
    era_key := 'monarchy_divided_kingdom';
    era_label := 'United & Divided Monarchy (Iron Age II — Israel, Judah & Near East)';
  end if;

  date_label := case
    when lo_year is null then 'Date range not established'
    when lo_year = hi_year then 'around ' || public.chronology_year_label(lo_year)
    else public.chronology_year_label(lo_year) || ' to ' || public.chronology_year_label(hi_year)
  end;

  chron_json := jsonb_build_object(
    'era_key', era_key,
    'era_label', era_label,
    'date_label', date_label,
    'earliest_year', lo_year,
    'latest_year', hi_year
  );

  -- 2. Resolve active passages (including narrative settings, audience_location, and composition_location)
  with active_passages as materialized (
    select
      pg.id as passage_id,
      pg.passage_key,
      pg.title,
      pg.book,
      pg.start_chapter,
      pg.start_verse,
      pg.end_chapter,
      pg.end_verse,
      pg.place_id,
      pg.relationship_type,
      pg.resolution_tier,
      pg.confidence_level,
      pg.evidence_refs,
      pg.evidence_explanation,
      pg.source_id,
      ((pg.end_chapter - pg.start_chapter) * 200 + (pg.end_verse - pg.start_verse)) as span_length
    from public.passage_geography pg
    where pg.published
      and pg.book = p_book::smallint
      and (pg.start_chapter, pg.start_verse) <= (p_chapter::smallint, p_verse::smallint)
      and (p_chapter::smallint, p_verse::smallint) <= (pg.end_chapter, pg.end_verse)
    order by pg.resolution_tier asc, span_length asc, pg.id asc
    limit 8
  ),
  direct_links as materialized (
    select
      vg.id as link_id,
      vg.place_id,
      vg.relationship_type,
      vg.resolution_tier,
      vg.is_inferred,
      vg.confidence_level,
      vg.evidence_ref,
      vg.evidence_explanation,
      coalesce(vg.establishing_passage_id, ap.passage_id) as passage_id,
      coalesce(ap.title, null) as passage_title,
      coalesce(ap.evidence_refs, vg.evidence_ref) as establishing_refs,
      vg.source_id,
      1 as source_priority
    from public.verse_geography vg
    left join active_passages ap on ap.place_id = vg.place_id
    where vg.verse_id = vid and vg.published
  ),
  inherited_links as materialized (
    select
      null::bigint as link_id,
      ap.place_id,
      ap.relationship_type,
      ap.resolution_tier,
      not exists (select 1 from direct_links dl where dl.place_id = ap.place_id) as is_inferred,
      ap.confidence_level,
      ap.evidence_refs as evidence_ref,
      ap.evidence_explanation,
      ap.passage_id,
      ap.title as passage_title,
      ap.evidence_refs as establishing_refs,
      ap.source_id,
      2 as source_priority
    from active_passages ap
    where ap.place_id is not null
      and not exists (
        select 1 from direct_links dl
        where dl.place_id = ap.place_id
          and dl.relationship_type in (
            'event_location',
            'contextual_location',
            'audience_location',
            'composition_location',
            'travel_origin',
            'travel_destination'
          )
      )
  ),
  combined_candidates as materialized (
    select * from direct_links
    union all
    select * from inherited_links
  ),
  deduped_places as materialized (
    select distinct on (cc.place_id)
      cc.place_id,
      cc.relationship_type,
      cc.resolution_tier,
      cc.is_inferred,
      cc.confidence_level,
      cc.evidence_ref,
      cc.evidence_explanation,
      cc.passage_id,
      cc.passage_title,
      cc.establishing_refs,
      cc.source_id
    from combined_candidates cc
    order by
      cc.place_id,
      case cc.relationship_type
        when 'travel_origin' then 1
        when 'travel_destination' then 2
        when 'event_location' then 3
        when 'contextual_location' then 4
        when 'audience_location' then 5
        when 'composition_location' then 6
        when 'uncertain_location' then 7
        else 8
      end asc,
      cc.source_priority asc,
      cc.resolution_tier asc
  ),
  hydrated_places as materialized (
    select
      dp.place_id,
      p.place_key,
      p.biblical_name,
      coalesce(
        p.period_names->>era_key,
        case
          when era_key = 'roman_new_testament' and p.greek_name is not null then p.biblical_name || ' (' || p.greek_name || ')'
          when p.hebrew_name is not null then p.biblical_name || ' (' || p.hebrew_name || ')'
          when p.greek_name is not null then p.biblical_name || ' (' || p.greek_name || ')'
          else p.biblical_name
        end
      ) as ancient_name,
      p.historical_names,
      p.hebrew_name,
      p.greek_name,
      p.strongs_numbers,
      p.place_type,
      p.is_non_physical,
      p.external_ids,
      dp.relationship_type,
      dp.resolution_tier,
      dp.is_inferred,
      dp.confidence_level,
      dp.evidence_ref,
      dp.evidence_explanation,
      dp.passage_title,
      dp.establishing_refs,
      gs.dataset as source_dataset,
      gs.license as source_license,
      gs.attribution as source_attribution,
      primary_loc.id as primary_location_id,
      primary_loc.modern_name,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.latitude end as latitude,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.longitude end as longitude,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.geometry end as geometry,
      case when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then null else primary_loc.bbox end as bbox,
      case
        when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then 'none'
        when dp.confidence_level = 'regional' then 'approximate_region'
        else coalesce(primary_loc.precision_kind, 'none')
      end as precision_kind,
      case
        when p.is_non_physical or dp.confidence_level = 'symbolic_non_physical' then 'unknown'
        when dp.confidence_level = 'regional' and primary_loc.location_status = 'established' then 'regional_only'
        else coalesce(primary_loc.location_status, 'unknown')
      end as location_status,
      coalesce(primary_loc.confidence_label, 'Symbolic or unknown location') as confidence_label,
      coalesce(primary_loc.raw_source_score, '{}'::jsonb) as raw_source_score,
      coalesce(primary_loc.evidence_summary, dp.evidence_explanation) as identification_evidence,
      coalesce(primary_loc.source_citations, '[]'::jsonb) as source_citations,
      coalesce(alts.alternatives, '[]'::jsonb) as alternative_locations,
      case dp.relationship_type
        when 'event_location' then 1
        when 'contextual_location' then 2
        when 'travel_origin' then 3
        when 'travel_destination' then 4
        when 'audience_location' then 5
        when 'composition_location' then 6
        when 'uncertain_location' then 7
        else 8
      end as role_rank
    from deduped_places dp
    join public.places p on p.id = dp.place_id and p.published
    join public.geography_sources gs on gs.id = dp.source_id and gs.published
    left join lateral (
      select pl.*
      from public.place_locations pl
      where pl.place_id = p.id and pl.published
      order by pl.rank_order asc, pl.id asc
      limit 1
    ) primary_loc on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', pl.id::text,
          'rank_order', pl.rank_order,
          'modern_name', pl.modern_name,
          'latitude', pl.latitude,
          'longitude', pl.longitude,
          'geometry', pl.geometry,
          'bbox', pl.bbox,
          'precision_kind', pl.precision_kind,
          'location_status', pl.location_status,
          'confidence_label', pl.confidence_label,
          'raw_source_score', pl.raw_source_score,
          'is_alternative', pl.is_alternative,
          'evidence_summary', pl.evidence_summary,
          'source_citations', pl.source_citations
        ) order by pl.rank_order asc, pl.id asc
      ) as alternatives
      from public.place_locations pl
      where pl.place_id = p.id and pl.published and pl.rank_order > 1
    ) alts on true
    order by role_rank asc, dp.resolution_tier asc, p.biblical_name asc
    limit 12
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'place_id', hp.place_id::text,
        'place_key', hp.place_key,
        'biblical_name', hp.biblical_name,
        'ancient_name', hp.ancient_name,
        'historical_names', hp.historical_names,
        'hebrew_name', hp.hebrew_name,
        'greek_name', hp.greek_name,
        'strongs_numbers', hp.strongs_numbers,
        'place_type', hp.place_type,
        'is_non_physical', hp.is_non_physical,
        'modern_name', hp.modern_name,
        'latitude', hp.latitude,
        'longitude', hp.longitude,
        'geometry', hp.geometry,
        'bbox', hp.bbox,
        'precision_kind', hp.precision_kind,
        'relationship_type', hp.relationship_type,
        'resolution_tier', hp.resolution_tier,
        'is_inferred', hp.is_inferred,
        'confidence_level', hp.confidence_level,
        'location_status', hp.location_status,
        'confidence_label', hp.confidence_label,
        'raw_source_score', hp.raw_source_score,
        'evidence_ref', hp.evidence_ref,
        'establishing_refs', hp.establishing_refs,
        'passage_title', hp.passage_title,
        'evidence_explanation', hp.evidence_explanation,
        'identification_evidence', hp.identification_evidence,
        'external_ids', hp.external_ids,
        'source_citations', hp.source_citations,
        'source', jsonb_build_object(
          'dataset', hp.source_dataset,
          'license', hp.source_license,
          'attribution', hp.source_attribution
        ),
        'alternative_locations', hp.alternative_locations
      ) order by hp.role_rank asc, hp.resolution_tier asc, hp.biblical_name asc
    ), '[]'::jsonb),
    coalesce(min(hp.resolution_tier) filter (where hp.relationship_type <> 'mentioned_location'), min(hp.resolution_tier)),
    bool_or(not hp.is_non_physical and (hp.latitude is not null or hp.geometry is not null)),
    bool_or(hp.is_non_physical or hp.confidence_level = 'symbolic_non_physical'),
    case
      when count(*) filter (where not hp.is_non_physical and hp.latitude is not null and hp.longitude is not null) > 0 then
        jsonb_build_array(
          min(coalesce(hp.bbox[1], hp.longitude)) filter (where not hp.is_non_physical and hp.longitude is not null),
          min(coalesce(hp.bbox[2], hp.latitude)) filter (where not hp.is_non_physical and hp.latitude is not null),
          max(coalesce(hp.bbox[3], hp.longitude)) filter (where not hp.is_non_physical and hp.longitude is not null),
          max(coalesce(hp.bbox[4], hp.latitude)) filter (where not hp.is_non_physical and hp.latitude is not null)
        )
      else null
    end
  into locations_json, top_tier, has_physical, has_non_physical, bounds_json
  from hydrated_places hp;

  -- 3. Build Era Gazetteer (contemporaneous ancient biblical places for the map background)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'place_key', g.place_key,
      'biblical_name', g.biblical_name,
      'ancient_name', g.ancient_name,
      'modern_name', g.modern_name,
      'place_type', g.place_type,
      'latitude', g.latitude,
      'longitude', g.longitude
    ) order by g.biblical_name asc
  ), '[]'::jsonb)
  into gazetteer_json
  from (
    select
      p.place_key,
      p.biblical_name,
      coalesce(p.period_names->>era_key, p.biblical_name) as ancient_name,
      pl.modern_name,
      p.place_type,
      pl.latitude,
      pl.longitude
    from public.places p
    join lateral (
      select loc.modern_name, loc.latitude, loc.longitude
      from public.place_locations loc
      where loc.place_id = p.id and loc.published and loc.latitude is not null and loc.longitude is not null
      order by loc.rank_order asc, loc.id asc
      limit 1
    ) pl on true
    where p.published
      and not p.is_non_physical
      and era_key = any(p.active_eras)
    limit 24
  ) g;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'passage_key', pg.passage_key,
      'title', pg.title,
      'book', pg.book,
      'start_chapter', pg.start_chapter,
      'start_verse', pg.start_verse,
      'end_chapter', pg.end_chapter,
      'end_verse', pg.end_verse,
      'relationship_type', pg.relationship_type,
      'resolution_tier', pg.resolution_tier,
      'confidence_level', pg.confidence_level,
      'evidence_refs', pg.evidence_refs,
      'evidence_explanation', pg.evidence_explanation
    ) order by pg.resolution_tier asc, pg.id asc
  ), '[]'::jsonb)
  into passages_json
  from public.passage_geography pg
  where pg.published
    and pg.book = p_book::smallint
    and (pg.start_chapter, pg.start_verse) <= (p_chapter::smallint, p_verse::smallint)
    and (p_chapter::smallint, p_verse::smallint) <= (pg.end_chapter, pg.end_verse);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'source_key', gs.source_key,
      'dataset', gs.dataset,
      'version', gs.version,
      'license', gs.license,
      'attribution', gs.attribution,
      'locator', gs.locator
    ) order by gs.id asc
  ), '[]'::jsonb)
  into sources_json
  from public.geography_sources gs
  where gs.published;

  res_status := case
    when coalesce(has_physical, false) then
      case top_tier
        when 1 then 'direct_event_location'
        when 2 then 'passage_context'
        when 3 then 'event_metadata'
        else 'regional_context'
      end
    when coalesce(has_non_physical, false) then 'symbolic_non_physical'
    else 'unknown'
  end;

  response := jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'passage', jsonb_build_object(
      'book', p_book,
      'chapter', p_chapter,
      'verse', p_verse,
      'is_heading', p_verse = 0
    ),
    'chronological_context', chron_json,
    'resolution_status', res_status,
    'has_physical_location', coalesce(has_physical, false),
    'message', case
      when coalesce(has_physical, false) then null
      when coalesce(has_non_physical, false) then 'No reliable geographical location identified for this verse (symbolic or heavenly setting).'
      else 'No reliable geographical location identified for this verse.'
    end,
    'bounds', bounds_json,
    'locations', coalesce(locations_json, '[]'::jsonb),
    'era_gazetteer', coalesce(gazetteer_json, '[]'::jsonb),
    'passage_contexts', coalesce(passages_json, '[]'::jsonb),
    'sources', coalesce(sources_json, '[]'::jsonb)
  );

  if octet_length(response::text) > 51200 then
    return jsonb_build_object('schema_version', 1, 'status', 'packet_limit_exceeded');
  end if;

  return response;
end
$rpc$;

notify pgrst, 'reload schema';
