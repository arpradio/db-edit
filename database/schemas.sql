--
-- PostgreSQL database dump
--

-- Dumped from database version 17.7 (Ubuntu 17.7-0ubuntu0.25.10.1)
-- Dumped by pg_dump version 17.5

-- Started on 2025-12-26 09:27:48

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 8 (class 2615 OID 20426)
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- TOC entry 9 (class 2615 OID 20427)
-- Name: cip60; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA cip60;


--
-- TOC entry 10 (class 2615 OID 20428)
-- Name: metadata; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA metadata;


--
-- TOC entry 2 (class 3079 OID 21749)
-- Name: plpython3u; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS plpython3u WITH SCHEMA pg_catalog;


--
-- TOC entry 3824 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION plpython3u; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION plpython3u IS 'PL/Python3U untrusted procedural language';


--
-- TOC entry 3 (class 3079 OID 30119)
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- TOC entry 3825 (class 0 OID 0)
-- Dependencies: 3
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- TOC entry 264 (class 1255 OID 21782)
-- Name: update_song_artist(integer, text, text, text); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.update_song_artist(p_song_id integer, p_old_artist_name text, p_new_artist_name text, p_role text DEFAULT 'primary'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_old_artist_id integer;
    v_new_artist_id integer;
BEGIN
    SELECT id INTO v_old_artist_id FROM metadata.artists WHERE name = p_old_artist_name;
    
    SELECT id INTO v_new_artist_id FROM metadata.artists WHERE name = p_new_artist_name;
    IF v_new_artist_id IS NULL THEN
        INSERT INTO metadata.artists (name) VALUES (p_new_artist_name) RETURNING id INTO v_new_artist_id;
    END IF;
    
    IF v_old_artist_id IS NOT NULL THEN
        UPDATE metadata.song_artists 
        SET artist_id = v_new_artist_id 
        WHERE song_id = p_song_id AND artist_id = v_old_artist_id AND role = p_role;
    ELSE
        INSERT INTO metadata.song_artists (song_id, artist_id, role) 
        VALUES (p_song_id, v_new_artist_id, p_role);
    END IF;
END;
$$;


--
-- TOC entry 265 (class 1255 OID 21783)
-- Name: update_song_genres(integer, text[]); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.update_song_genres(p_song_id integer, p_genre_names text[]) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_genre_name text;
    v_genre_id integer;
BEGIN
    DELETE FROM metadata.song_genres WHERE song_id = p_song_id;
    
    FOREACH v_genre_name IN ARRAY p_genre_names
    LOOP
        SELECT id INTO v_genre_id FROM metadata.genres WHERE name = v_genre_name;
        IF v_genre_id IS NULL THEN
            INSERT INTO metadata.genres (name) VALUES (v_genre_name) RETURNING id INTO v_genre_id;
        END IF;
        
        INSERT INTO metadata.song_genres (song_id, genre_id) VALUES (p_song_id, v_genre_id);
    END LOOP;
END;
$$;


--
-- TOC entry 326 (class 1255 OID 21907)
-- Name: asset_fingerprint(text, text); Type: FUNCTION; Schema: cip60; Owner: -
--

CREATE FUNCTION cip60.asset_fingerprint(policy_id text, asset_name text) RETURNS text
    LANGUAGE plpython3u IMMUTABLE STRICT
    AS $$
from hashlib import blake2b

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

def polymod(values):
    GEN = [0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3]
    chk = 1
    for v in values:
        b = (chk >> 25)
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for i in range(5):
            if ((b >> i) & 1):
                chk ^= GEN[i]
    return chk

def hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def create_checksum(hrp, data):
    values = hrp_expand(hrp) + data
    polymod_result = polymod(values + [0,0,0,0,0,0]) ^ 1
    return [(polymod_result >> 5*(5-i)) & 31 for i in range(6)]

def bech32_encode(hrp, data):
    combined = data + create_checksum(hrp, data)
    return hrp + '1' + ''.join([CHARSET[d] for d in combined])

def convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    for value in data:
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        return None
    return ret

message = bytes.fromhex(policy_id) + bytes.fromhex(asset_name)
digest = blake2b(message, digest_size=20).digest()
data = convertbits(digest, 8, 5, True)
return bech32_encode('asset', data)
$$;


--
-- TOC entry 310 (class 1255 OID 21754)
-- Name: decode_cbor_to_json(text); Type: FUNCTION; Schema: cip60; Owner: -
--

CREATE FUNCTION cip60.decode_cbor_to_json(cbor_hex text) RETURNS jsonb
    LANGUAGE plpython3u IMMUTABLE
    AS $$
import cbor2
import json

if cbor_hex is None:
    return None

try:
    cbor_bytes = bytes.fromhex(cbor_hex)
    decoded = cbor2.loads(cbor_bytes)
    
    if hasattr(decoded, 'tag') and hasattr(decoded, 'value'):
        if decoded.tag == 121 and isinstance(decoded.value, list) and len(decoded.value) > 0:
            data = decoded.value[0]
        else:
            data = decoded.value
    else:
        data = decoded
    
    def convert_to_serializable(obj):
        if isinstance(obj, bytes):
            try:
                return obj.decode('utf-8')
            except:
                return obj.hex()
        elif isinstance(obj, dict):
            return {convert_to_serializable(k): convert_to_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_to_serializable(item) for item in obj]
        elif isinstance(obj, tuple):
            return [convert_to_serializable(item) for item in obj]
        else:
            return obj
    
    serializable = convert_to_serializable(data)
    return json.dumps(serializable)
except Exception as e:
    plpy.warning(f"CBOR decode error: {str(e)}")
    return None
$$;


--
-- TOC entry 324 (class 1255 OID 21861)
-- Name: extract_metadata_fields(jsonb); Type: FUNCTION; Schema: cip60; Owner: -
--

CREATE FUNCTION cip60.extract_metadata_fields(metadata jsonb) RETURNS TABLE(release_type text, genres text[], artists jsonb[], song_title text, duration text, track_number integer, copyright_master text, copyright_composition text, isrc text, iswc text, is_explicit boolean, is_ai_generated boolean, audio_files jsonb[], distributor text, release_title text, release_date text, image_urls text[])
    LANGUAGE plpython3u IMMUTABLE
    AS $$
import json

if metadata is None:
    return None

try:
    data = json.loads(metadata) if isinstance(metadata, str) else metadata
except:
    return None

result = {
    'release_type': None,
    'genres': [],
    'artists': [],
    'song_title': None,
    'duration': None,
    'track_number': None,
    'copyright_master': None,
    'copyright_composition': None,
    'isrc': None,
    'iswc': None,
    'is_explicit': None,
    'is_ai_generated': None,
    'audio_files': [],
    'distributor': None,
    'release_title': None,
    'release_date': None,
    'image_urls': []
}

def safe_int(val):
    try:
        return int(val)
    except:
        return None

def safe_bool(val):
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ('true', 'explicit', 'yes', '1')
    return None

def normalize_text(val):
    if val is None:
        return None
    return str(val).strip() if str(val).strip() else None

def get_field_variants(obj, *variants):
    for variant in variants:
        if variant in obj:
            return obj[variant]
    return None

version = get_field_variants(data, 'music_metadata_version', 'Music Metadata Version')
version_str = str(version).lower() if version else 'unknown'

if version_str in ('v3', '3'):
    release_obj = data.get('release', {})
    if isinstance(release_obj, dict):
        result['release_type'] = normalize_text(release_obj.get('release_type'))
        result['release_title'] = normalize_text(release_obj.get('release_title'))
        result['release_date'] = normalize_text(release_obj.get('release_date'))
        result['distributor'] = normalize_text(release_obj.get('distributor'))
    
    files = data.get('files', [])
    for file_item in files:
        if isinstance(file_item, dict):
            song = file_item.get('song', {})
            if song:
                result['song_title'] = normalize_text(song.get('song_title'))
                result['duration'] = normalize_text(song.get('song_duration'))
                result['track_number'] = safe_int(song.get('track_number'))
                result['isrc'] = normalize_text(song.get('isrc'))
                result['iswc'] = normalize_text(song.get('iswc'))
                result['is_explicit'] = safe_bool(song.get('explicit'))
                result['is_ai_generated'] = safe_bool(song.get('ai_generated'))
                
                copyright_data = song.get('copyright', {})
                if isinstance(copyright_data, dict):
                    result['copyright_master'] = normalize_text(copyright_data.get('master'))
                    result['copyright_composition'] = normalize_text(copyright_data.get('composition'))
                elif isinstance(copyright_data, str):
                    result['copyright_master'] = normalize_text(copyright_data)
                
                genres_data = song.get('genres', [])
                if isinstance(genres_data, list):
                    result['genres'] = [str(g).strip() for g in genres_data if g]
                elif genres_data:
                    result['genres'] = [str(genres_data).strip()]
                
                artists_data = song.get('artists', [])
                if isinstance(artists_data, list):
                    result['artists'] = [json.dumps(a) for a in artists_data]
                elif artists_data:
                    result['artists'] = [json.dumps({'name': str(artists_data)})]
            
            media_type = file_item.get('mediaType', '')
            if 'audio' in media_type.lower():
                result['audio_files'].append(json.dumps(file_item))

elif version_str in ('v2', '2'):
    release_obj = data.get('release', {})
    if isinstance(release_obj, dict):
        result['release_type'] = normalize_text(release_obj.get('release_type'))
        result['release_title'] = normalize_text(release_obj.get('release_title') or release_obj.get('album_title'))
        result['release_date'] = normalize_text(release_obj.get('release_date'))
        result['distributor'] = normalize_text(release_obj.get('distributor'))
        result['song_title'] = normalize_text(release_obj.get('song_title'))
        result['duration'] = normalize_text(release_obj.get('song_duration'))
        result['track_number'] = safe_int(release_obj.get('track_number'))
        result['isrc'] = normalize_text(release_obj.get('isrc'))
        result['iswc'] = normalize_text(release_obj.get('iswc'))
        
        copyright_data = release_obj.get('copyright')
        if isinstance(copyright_data, dict):
            result['copyright_master'] = normalize_text(copyright_data.get('master'))
            result['copyright_composition'] = normalize_text(copyright_data.get('composition'))
        elif copyright_data:
            result['copyright_master'] = normalize_text(copyright_data)
        
        genres_data = release_obj.get('genres', [])
        if isinstance(genres_data, list):
            result['genres'] = [str(g).strip() for g in genres_data if g]
        elif genres_data:
            result['genres'] = [str(genres_data).strip()]
        
        artists_data = release_obj.get('artists')
        if isinstance(artists_data, list):
            result['artists'] = [json.dumps({'name': a}) if isinstance(a, str) else json.dumps(a) for a in artists_data]
        elif artists_data:
            result['artists'] = [json.dumps({'name': str(artists_data)})]
    
    song_obj = data.get('song', {})
    if isinstance(song_obj, dict) and song_obj:
        result['song_title'] = normalize_text(song_obj.get('song_title')) or result['song_title']
        result['duration'] = normalize_text(song_obj.get('song_duration')) or result['duration']
        result['track_number'] = safe_int(song_obj.get('track_number')) or result['track_number']
        result['is_explicit'] = safe_bool(song_obj.get('explicit', song_obj.get('parental_advisory')))
        
        if not result['genres']:
            genres_data = song_obj.get('genres', [])
            if isinstance(genres_data, list):
                result['genres'] = [str(g).strip() for g in genres_data if g]
            elif genres_data:
                result['genres'] = [str(genres_data).strip()]
        
        if not result['artists']:
            artists_data = song_obj.get('artists')
            if isinstance(artists_data, list):
                result['artists'] = [json.dumps({'name': a}) if isinstance(a, str) else json.dumps(a) for a in artists_data]
            elif artists_data:
                result['artists'] = [json.dumps({'name': str(artists_data)})]
    
    files = data.get('files', [])
    for file_item in files:
        if isinstance(file_item, dict):
            media_type = file_item.get('mediaType', '')
            if 'audio' in media_type.lower():
                result['audio_files'].append(json.dumps(file_item))

else:
    result['release_type'] = normalize_text(get_field_variants(data, 'release_type', 'Release Type'))
    result['song_title'] = normalize_text(get_field_variants(data, 'song_title', 'Song Title'))
    result['release_title'] = normalize_text(get_field_variants(data, 'album_title', 'Album Title'))
    result['duration'] = normalize_text(get_field_variants(data, 'song_duration', 'Song Duration'))
    result['distributor'] = normalize_text(get_field_variants(data, 'distributor', 'Distributor'))
    result['release_date'] = normalize_text(get_field_variants(data, 'release_date', 'Release Date'))
    
    track_val = get_field_variants(data, 'track_number', 'Track #', 'Track', 'track')
    result['track_number'] = safe_int(track_val)
    
    result['isrc'] = normalize_text(get_field_variants(data, 'isrc', 'ISRC'))
    result['iswc'] = normalize_text(get_field_variants(data, 'iswc', 'ISWC'))
    result['copyright_master'] = normalize_text(get_field_variants(data, 'copyright', 'Copyright'))
    
    explicit_val = get_field_variants(data, 'explicit', 'parental_advisory', 'Parental Advisory')
    result['is_explicit'] = safe_bool(explicit_val)
    
    genres_data = get_field_variants(data, 'genres', 'Genre', 'genre')
    if isinstance(genres_data, list):
        result['genres'] = [str(g).strip() for g in genres_data if g]
    elif genres_data:
        result['genres'] = [str(genres_data).strip()]
    
    sub_genre_data = get_field_variants(data, 'sub_genre', 'Sub-Genre', 'Sub Genre', 'subgenre')
    if sub_genre_data:
        if isinstance(sub_genre_data, list):
            result['genres'].extend([str(g).strip() for g in sub_genre_data if g])
        else:
            result['genres'].append(str(sub_genre_data).strip())
    
    artists_data = get_field_variants(data, 'artists', 'Artist Name', 'Artist', 'artist')
    if isinstance(artists_data, list):
        result['artists'] = [json.dumps({'name': a}) if isinstance(a, str) else json.dumps(a) for a in artists_data]
    elif artists_data:
        result['artists'] = [json.dumps({'name': str(artists_data)})]
    
    files = data.get('files', [])
    for file_item in files:
        if isinstance(file_item, dict):
            media_type = file_item.get('mediaType', '')
            if 'audio' in media_type.lower():
                result['audio_files'].append(json.dumps(file_item))

if result['release_type']:
    result['release_type'] = result['release_type'].title()
else:
    audio_count = len(result['audio_files'])
    if audio_count > 1:
        audio_with_names = 0
        for audio_json in result['audio_files']:
            try:
                audio_obj = json.loads(audio_json)
                if audio_obj.get('name'):
                    audio_with_names += 1
            except:
                pass
        
        if audio_with_names >= 2:
            result['release_type'] = 'Multiple'
        else:
            result['release_type'] = 'Single'
    else:
        result['release_type'] = 'Single'

image_data = get_field_variants(data, 'image', 'Image')
if isinstance(image_data, list):
    result['image_urls'] = [normalize_text(img) for img in image_data if img]
elif image_data:
    normalized_img = normalize_text(image_data)
    if normalized_img:
        result['image_urls'] = [normalized_img]

files = data.get('files', [])
for file_item in files:
    if isinstance(file_item, dict):
        media_type = file_item.get('mediaType', '')
        if 'image' in media_type.lower():
            img_src = normalize_text(file_item.get('src'))
            if img_src and img_src not in result['image_urls']:
                result['image_urls'].append(img_src)

return [(
    result['release_type'],
    result['genres'],
    result['artists'],
    result['song_title'],
    result['duration'],
    result['track_number'],
    result['copyright_master'],
    result['copyright_composition'],
    result['isrc'],
    result['iswc'],
    result['is_explicit'],
    result['is_ai_generated'],
    result['audio_files'],
    result['distributor'],
    result['release_title'],
    result['release_date'],
    result['image_urls']
)]
$$;


--
-- TOC entry 327 (class 1255 OID 21864)
-- Name: process_all_tokens(); Type: FUNCTION; Schema: cip60; Owner: -
--

CREATE FUNCTION cip60.process_all_tokens() RETURNS TABLE(total_processed integer, successful integer, failed integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_asset_id integer;
    v_total integer := 0;
    v_success integer := 0;
    v_failed integer := 0;
BEGIN
    FOR v_asset_id IN 
        SELECT id FROM cip60.music_tokens
        WHERE id NOT IN (SELECT asset_id FROM cip60.processing_status WHERE status = 'processed')
        ORDER BY id
    LOOP
        v_total := v_total + 1;
        
        BEGIN
            PERFORM cip60.process_token_metadata(v_asset_id);
            v_success := v_success + 1;
            
            IF v_total % 100 = 0 THEN
                RAISE NOTICE 'Processed % tokens (% successful, % failed)', v_total, v_success, v_failed;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                v_failed := v_failed + 1;
                RAISE NOTICE 'Failed to process asset %: %', v_asset_id, SQLERRM;
        END;
    END LOOP;
    
    RETURN QUERY SELECT v_total, v_success, v_failed;
END;
$$;


--
-- TOC entry 325 (class 1255 OID 21863)
-- Name: process_token_metadata(integer); Type: FUNCTION; Schema: cip60; Owner: -
--

CREATE FUNCTION cip60.process_token_metadata(p_asset_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_metadata jsonb;
    v_extracted record;
    v_song_id integer;
    v_artist_id integer;
    v_genre_id integer;
    v_artist_data jsonb;
    v_artist_name text;
    v_genre_name text;
    v_audio_file jsonb;
    v_file_url text;
    v_file_type text;
    v_image_id integer;
    v_image_url text;
    v_image_type text;
BEGIN
    SELECT metadata INTO v_metadata 
    FROM cip60.music_tokens 
    WHERE id = p_asset_id;
    
    IF v_metadata IS NULL THEN
        RETURN;
    END IF;
    
    SELECT * INTO v_extracted 
    FROM cip60.extract_metadata_fields(v_metadata);
    
    IF v_extracted.release_type IS NULL OR 
       LOWER(v_extracted.release_type) NOT IN ('single', 'multiple', 'album', 'album/ep', 'ep') THEN
        v_extracted.release_type := 'Single';
    END IF;
    
    IF LOWER(v_extracted.release_type) IN ('single') THEN
        IF v_extracted.song_title IS NULL THEN
            RETURN;
        END IF;
        
        SELECT s.id INTO v_song_id
        FROM metadata.songs s
        WHERE s.title = v_extracted.song_title
        AND (s.isrc = v_extracted.isrc OR (s.isrc IS NULL AND v_extracted.isrc IS NULL))
        LIMIT 1;
        
        IF v_song_id IS NULL THEN
            INSERT INTO metadata.songs (
                title,
                duration,
                is_explicit,
                is_ai_generated,
                copyright_master,
                copyright_composition,
                isrc,
                iswc,
                validation_status
            ) VALUES (
                v_extracted.song_title,
                v_extracted.duration,
                COALESCE(v_extracted.is_explicit, false),
                COALESCE(v_extracted.is_ai_generated, false),
                v_extracted.copyright_master,
                v_extracted.copyright_composition,
                v_extracted.isrc,
                v_extracted.iswc,
                'unverified'
            )
            RETURNING id INTO v_song_id;
        END IF;
        
        IF v_song_id IS NOT NULL THEN
            INSERT INTO metadata.assets_songs (asset_id, song_id, is_primary)
            VALUES (p_asset_id, v_song_id, true)
            ON CONFLICT (asset_id, song_id) DO NOTHING;
            
            IF v_extracted.artists IS NOT NULL THEN
                FOREACH v_artist_data IN ARRAY v_extracted.artists
                LOOP
                    v_artist_name := v_artist_data->>'name';
                    IF v_artist_name IS NOT NULL AND trim(v_artist_name) != '' THEN
                        SELECT id INTO v_artist_id
                        FROM metadata.artists
                        WHERE name = trim(v_artist_name);
                        
                        IF v_artist_id IS NULL THEN
                            INSERT INTO metadata.artists (name)
                            VALUES (trim(v_artist_name))
                            RETURNING id INTO v_artist_id;
                        END IF;
                        
                        IF v_artist_id IS NOT NULL THEN
                            INSERT INTO metadata.song_artists (song_id, artist_id, role)
                            VALUES (v_song_id, v_artist_id, 'primary')
                            ON CONFLICT (song_id, artist_id, role) DO NOTHING;
                        END IF;
                    END IF;
                END LOOP;
            END IF;
            
            IF v_extracted.genres IS NOT NULL THEN
                FOREACH v_genre_name IN ARRAY v_extracted.genres
                LOOP
                    IF v_genre_name IS NOT NULL AND trim(v_genre_name) != '' THEN
                        SELECT id INTO v_genre_id
                        FROM metadata.genres
                        WHERE name = trim(v_genre_name);
                        
                        IF v_genre_id IS NULL THEN
                            INSERT INTO metadata.genres (name)
                            VALUES (trim(v_genre_name))
                            RETURNING id INTO v_genre_id;
                        END IF;
                        
                        IF v_genre_id IS NOT NULL THEN
                            INSERT INTO metadata.song_genres (song_id, genre_id)
                            VALUES (v_song_id, v_genre_id)
                            ON CONFLICT (song_id, genre_id) DO NOTHING;
                        END IF;
                    END IF;
                END LOOP;
            END IF;
            
            IF v_extracted.audio_files IS NOT NULL THEN
                FOREACH v_audio_file IN ARRAY v_extracted.audio_files
                LOOP
                    v_file_url := v_audio_file->>'src';
                    v_file_type := CASE 
                        WHEN v_audio_file->>'mediaType' LIKE '%mpeg%' THEN 'mp3'
                        WHEN v_audio_file->>'mediaType' LIKE '%mp3%' THEN 'mp3'
                        WHEN v_audio_file->>'mediaType' LIKE '%mp4%' THEN 'mp4'
                        WHEN v_audio_file->>'mediaType' LIKE '%wav%' THEN 'wav'
                        WHEN v_audio_file->>'mediaType' LIKE '%flac%' THEN 'flac'
                        ELSE 'audio'
                    END;
                    
                    IF v_file_url IS NOT NULL THEN
                        INSERT INTO metadata.audio_files (song_id, file_url, file_type)
                        VALUES (v_song_id, v_file_url, v_file_type)
                        ON CONFLICT (file_url) DO NOTHING;
                    END IF;
                END LOOP;
            END IF;
        END IF;
        
    ELSIF LOWER(v_extracted.release_type) IN ('multiple', 'album', 'album/ep', 'ep') THEN
        IF v_extracted.audio_files IS NULL OR array_length(v_extracted.audio_files, 1) = 0 THEN
            RETURN;
        END IF;
        
        FOREACH v_audio_file IN ARRAY v_extracted.audio_files
        LOOP
            v_file_url := v_audio_file->>'src';
            v_file_type := CASE 
                WHEN v_audio_file->>'mediaType' LIKE '%mpeg%' THEN 'mp3'
                WHEN v_audio_file->>'mediaType' LIKE '%mp3%' THEN 'mp3'
                WHEN v_audio_file->>'mediaType' LIKE '%mp4%' THEN 'mp4'
                WHEN v_audio_file->>'mediaType' LIKE '%wav%' THEN 'wav'
                WHEN v_audio_file->>'mediaType' LIKE '%flac%' THEN 'flac'
                ELSE 'audio'
            END;
            
            IF v_file_url IS NULL THEN
                CONTINUE;
            END IF;
            
            v_song_id := NULL;
            
            IF v_audio_file->>'name' IS NOT NULL AND trim(v_audio_file->>'name') != '' THEN
                SELECT s.id INTO v_song_id
                FROM metadata.songs s
                WHERE s.title = trim(v_audio_file->>'name')
                LIMIT 1;
                
                IF v_song_id IS NULL THEN
                    INSERT INTO metadata.songs (
                        title,
                        duration,
                        is_explicit,
                        is_ai_generated,
                        copyright_master,
                        copyright_composition,
                        isrc,
                        iswc,
                        validation_status
                    ) VALUES (
                        trim(v_audio_file->>'name'),
                        v_extracted.duration,
                        COALESCE(v_extracted.is_explicit, false),
                        COALESCE(v_extracted.is_ai_generated, false),
                        v_extracted.copyright_master,
                        v_extracted.copyright_composition,
                        v_extracted.isrc,
                        v_extracted.iswc,
                        'unverified'
                    )
                    RETURNING id INTO v_song_id;
                END IF;
            END IF;
            
            IF v_song_id IS NOT NULL THEN
                INSERT INTO metadata.assets_songs (asset_id, song_id, is_primary)
                VALUES (p_asset_id, v_song_id, false)
                ON CONFLICT (asset_id, song_id) DO NOTHING;
                
                INSERT INTO metadata.audio_files (song_id, file_url, file_type)
                VALUES (v_song_id, v_file_url, v_file_type)
                ON CONFLICT (file_url) DO NOTHING;
                
                IF v_extracted.artists IS NOT NULL THEN
                    FOREACH v_artist_data IN ARRAY v_extracted.artists
                    LOOP
                        v_artist_name := v_artist_data->>'name';
                        IF v_artist_name IS NOT NULL AND trim(v_artist_name) != '' THEN
                            SELECT id INTO v_artist_id
                            FROM metadata.artists
                            WHERE name = trim(v_artist_name);
                            
                            IF v_artist_id IS NULL THEN
                                INSERT INTO metadata.artists (name)
                                VALUES (trim(v_artist_name))
                                RETURNING id INTO v_artist_id;
                            END IF;
                            
                            IF v_artist_id IS NOT NULL THEN
                                INSERT INTO metadata.song_artists (song_id, artist_id, role)
                                VALUES (v_song_id, v_artist_id, 'primary')
                                ON CONFLICT (song_id, artist_id, role) DO NOTHING;
                            END IF;
                        END IF;
                    END LOOP;
                END IF;
                
                IF v_extracted.genres IS NOT NULL THEN
                    FOREACH v_genre_name IN ARRAY v_extracted.genres
                    LOOP
                        IF v_genre_name IS NOT NULL AND trim(v_genre_name) != '' THEN
                            SELECT id INTO v_genre_id
                            FROM metadata.genres
                            WHERE name = trim(v_genre_name);
                            
                            IF v_genre_id IS NULL THEN
                                INSERT INTO metadata.genres (name)
                                VALUES (trim(v_genre_name))
                                RETURNING id INTO v_genre_id;
                            END IF;
                            
                            IF v_genre_id IS NOT NULL THEN
                                INSERT INTO metadata.song_genres (song_id, genre_id)
                                VALUES (v_song_id, v_genre_id)
                                ON CONFLICT (song_id, genre_id) DO NOTHING;
                            END IF;
                        END IF;
                    END LOOP;
                END IF;
            END IF;
        END LOOP;
    END IF;
    
    IF v_extracted.image_urls IS NOT NULL THEN
        FOREACH v_image_url IN ARRAY v_extracted.image_urls
        LOOP
            IF v_image_url IS NOT NULL AND trim(v_image_url) != '' THEN
                v_image_type := CASE 
                    WHEN v_image_url LIKE '%.png%' THEN 'png'
                    WHEN v_image_url LIKE '%.jpg%' OR v_image_url LIKE '%.jpeg%' THEN 'jpeg'
                    WHEN v_image_url LIKE '%.webp%' THEN 'webp'
                    WHEN v_image_url LIKE '%.gif%' THEN 'gif'
                    WHEN v_image_url LIKE '%.svg%' THEN 'svg'
                    ELSE 'image'
                END;
                
                SELECT id INTO v_image_id
                FROM metadata.images
                WHERE image_url = v_image_url;
                
                IF v_image_id IS NULL THEN
                    INSERT INTO metadata.images (image_url, image_type)
                    VALUES (v_image_url, v_image_type)
                    RETURNING id INTO v_image_id;
                END IF;
                
                IF v_image_id IS NOT NULL THEN
                    INSERT INTO metadata.asset_images (asset_id, image_id, is_primary)
                    VALUES (p_asset_id, v_image_id, true)
                    ON CONFLICT (asset_id, image_id) DO NOTHING;
                END IF;
            END IF;
        END LOOP;
    END IF;
    
    INSERT INTO cip60.processing_status (asset_id, processed_at, has_valid_songs, status)
        VALUES (p_asset_id, now(), true, 'processed')
        ON CONFLICT (asset_id) DO UPDATE
        SET processed_at = now(), has_valid_songs = true, status = 'processed';
EXCEPTION
    WHEN OTHERS THEN
        INSERT INTO cip60.processing_status (asset_id, processed_at, has_valid_songs, status)
        VALUES (p_asset_id, now(), false, 'failed')
        ON CONFLICT (asset_id) DO UPDATE
        SET processed_at = now(), has_valid_songs = false, status = 'failed';
        RAISE NOTICE 'Error processing asset %: %', p_asset_id, SQLERRM;
END;
$$;


--
-- TOC entry 311 (class 1255 OID 21785)
-- Name: add_song_artist(integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_song_artist(song_id_param integer, artist_name text, artist_role text DEFAULT 'primary'::text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    artist_id_val integer;
BEGIN
    -- Get or create artist
    SELECT id INTO artist_id_val 
    FROM metadata.artists 
    WHERE name = artist_name;
    
    IF artist_id_val IS NULL THEN
        INSERT INTO metadata.artists (name) 
        VALUES (artist_name) 
        RETURNING id INTO artist_id_val;
    END IF;
    
    -- Add the relationship
    INSERT INTO metadata.song_artists (song_id, artist_id, role) 
    VALUES (song_id_param, artist_id_val, artist_role)
    ON CONFLICT (song_id, artist_id, role) DO NOTHING;
    
    RETURN format('Added "%s" as %s artist for song ID %s', 
                  artist_name, artist_role, song_id_param);
END;
$$;


--
-- TOC entry 269 (class 1255 OID 21906)
-- Name: asset_fingerprint(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asset_fingerprint(policy_id text, asset_name text) RETURNS text
    LANGUAGE plpython3u IMMUTABLE STRICT
    AS $$
from hashlib import blake2b
from bech32 import bech32_encode, convertbits

# Step 1: concatenate policy_id and asset_name as bytes
message = bytes.fromhex(policy_id) + asset_name.encode('utf-8')

# Step 2: blake2b hash, 20-byte digest
digest = blake2b(message, digest_size=20).digest()

# Step 3: convert to 5-bit groups for Bech32
data = convertbits(digest, 8, 5, True)

# Step 4: encode with HRP 'asset'
return bech32_encode('asset', data)
$$;


--
-- TOC entry 289 (class 1255 OID 21784)
-- Name: edit_song_artist(integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.edit_song_artist(song_id_param integer, old_artist_name text, new_artist_name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    old_artist_id integer;
    new_artist_id integer;
    affected_rows integer;
BEGIN
    -- Get old artist ID
    SELECT id INTO old_artist_id 
    FROM metadata.artists 
    WHERE name = old_artist_name;
    
    -- Get or create new artist
    SELECT id INTO new_artist_id 
    FROM metadata.artists 
    WHERE name = new_artist_name;
    
    IF new_artist_id IS NULL THEN
        INSERT INTO metadata.artists (name) 
        VALUES (new_artist_name) 
        RETURNING id INTO new_artist_id;
    END IF;
    
    -- Update the relationship
    UPDATE metadata.song_artists 
    SET artist_id = new_artist_id 
    WHERE song_id = song_id_param AND artist_id = old_artist_id;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    RETURN format('Updated %s rows. Artist changed from "%s" to "%s" for song ID %s', 
                  affected_rows, old_artist_name, new_artist_name, song_id_param);
END;
$$;


--
-- TOC entry 320 (class 1255 OID 21823)
-- Name: find_artists_without_isni(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_artists_without_isni(result_limit integer DEFAULT 100) RETURNS TABLE(artist_id integer, artist_name text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT a.id, a.name
    FROM metadata.artists a
    WHERE a.isni IS NULL OR TRIM(a.isni) = ''
    ORDER BY a.name
    LIMIT result_limit;
END;
$$;


--
-- TOC entry 319 (class 1255 OID 21822)
-- Name: find_orphaned_images(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_orphaned_images(result_limit integer DEFAULT 100) RETURNS TABLE(image_id integer, image_url text, image_type character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT i.id, i.image_url, i.image_type
    FROM metadata.images i
    LEFT JOIN metadata.asset_images ai ON i.id = ai.image_id
    WHERE ai.image_id IS NULL
    ORDER BY i.id
    LIMIT result_limit;
END;
$$;


--
-- TOC entry 316 (class 1255 OID 21818)
-- Name: find_songs_without_artists(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_songs_without_artists(result_limit integer DEFAULT 100) RETURNS TABLE(song_id integer, song_title text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.title
    FROM metadata.songs s
    LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
    WHERE sa.song_id IS NULL
    ORDER BY s.title
    LIMIT result_limit;
END;
$$;


--
-- TOC entry 318 (class 1255 OID 21820)
-- Name: find_songs_without_copyright(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_songs_without_copyright(result_limit integer DEFAULT 100) RETURNS TABLE(song_id integer, song_title text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.title
    FROM metadata.songs s
    WHERE (s.copyright_master IS NULL OR TRIM(s.copyright_master) = '')
      AND (s.copyright_composition IS NULL OR TRIM(s.copyright_composition) = '')
    ORDER BY s.title
    LIMIT result_limit;
END;
$$;


--
-- TOC entry 317 (class 1255 OID 21819)
-- Name: find_songs_without_genres(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_songs_without_genres(result_limit integer DEFAULT 100) RETURNS TABLE(song_id integer, song_title text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.title
    FROM metadata.songs s
    LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
    WHERE sg.song_id IS NULL
    ORDER BY s.title
    LIMIT result_limit;
END;
$$;


--
-- TOC entry 323 (class 1255 OID 21826)
-- Name: find_songs_without_images(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_songs_without_images(result_limit integer DEFAULT 100) RETURNS TABLE(song_id integer, song_title text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT s.id, s.title
    FROM metadata.songs s
    LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
    LEFT JOIN metadata.asset_images ai ON asongs.asset_id = ai.asset_id
    WHERE ai.asset_id IS NULL
    ORDER BY s.title
    LIMIT result_limit;
END;
$$;


--
-- TOC entry 322 (class 1255 OID 21825)
-- Name: get_quality_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_quality_counts() RETURNS TABLE(no_artists bigint, no_genres bigint, no_audio bigint, no_duration bigint, no_isrc bigint, no_iswc bigint, no_tokens bigint, no_copyright bigint, no_images bigint, orphan_artists bigint, orphan_genres bigint, orphan_contributors bigint, orphan_tokens bigint, orphan_images bigint, unprocessed_tokens bigint, failed_tokens bigint, artists_no_isni bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        -- Songs without artists
        (SELECT COUNT(*) FROM metadata.songs s
         LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
         WHERE sa.song_id IS NULL)::BIGINT,

        -- Songs without genres
        (SELECT COUNT(*) FROM metadata.songs s
         LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
         WHERE sg.song_id IS NULL)::BIGINT,

        -- Songs without audio files
        (SELECT COUNT(*) FROM metadata.songs s
         LEFT JOIN metadata.audio_files af ON s.id = af.song_id
         WHERE af.song_id IS NULL)::BIGINT,

        -- Songs without duration
        (SELECT COUNT(*) FROM metadata.songs WHERE duration IS NULL OR TRIM(duration) = '')::BIGINT,

        -- Songs without ISRC
        (SELECT COUNT(*) FROM metadata.songs WHERE isrc IS NULL OR TRIM(isrc) = '')::BIGINT,

        -- Songs without ISWC
        (SELECT COUNT(*) FROM metadata.songs WHERE iswc IS NULL OR TRIM(iswc) = '')::BIGINT,

        -- Songs without tokens
        (SELECT COUNT(*) FROM metadata.songs s
         LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
         WHERE asongs.song_id IS NULL)::BIGINT,

        -- Songs without copyright
        (SELECT COUNT(*) FROM metadata.songs
         WHERE (copyright_master IS NULL OR TRIM(copyright_master) = '')
         AND (copyright_composition IS NULL OR TRIM(copyright_composition) = ''))::BIGINT,

        -- Songs without images
        (SELECT COUNT(DISTINCT s.id) FROM metadata.songs s
         LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
         LEFT JOIN metadata.asset_images ai ON asongs.asset_id = ai.asset_id
         WHERE ai.asset_id IS NULL)::BIGINT,

        -- Orphaned artists
        (SELECT COUNT(*) FROM metadata.artists a
         LEFT JOIN metadata.song_artists sa ON a.id = sa.artist_id
         WHERE sa.artist_id IS NULL)::BIGINT,

        -- Orphaned genres
        (SELECT COUNT(*) FROM metadata.genres g
         LEFT JOIN metadata.song_genres sg ON g.id = sg.genre_id
         WHERE sg.genre_id IS NULL)::BIGINT,

        -- Orphaned contributors
        (SELECT COUNT(*) FROM metadata.contributor c
         LEFT JOIN metadata.song_contributors sc ON c.id = sc.contributor_id
         WHERE sc.contributor_id IS NULL)::BIGINT,

        -- Orphaned tokens
        (SELECT COUNT(*) FROM cip60.music_tokens mt
         LEFT JOIN metadata.assets_songs aso ON mt.id = aso.asset_id
         WHERE aso.asset_id IS NULL)::BIGINT,

        -- Orphaned images
        (SELECT COUNT(*) FROM metadata.images i
         LEFT JOIN metadata.asset_images ai ON i.id = ai.image_id
         WHERE ai.image_id IS NULL)::BIGINT,

        -- Unprocessed tokens
        (SELECT COUNT(*) FROM cip60.music_tokens mt
         LEFT JOIN cip60.processing_status ps ON mt.id = ps.asset_id
         WHERE ps.asset_id IS NULL)::BIGINT,

        -- Failed tokens
        (SELECT COUNT(*) FROM cip60.processing_status
         WHERE status = 'failed' OR has_valid_songs = false)::BIGINT,

        -- Artists without ISNI
        (SELECT COUNT(*) FROM metadata.artists
         WHERE isni IS NULL OR TRIM(isni) = '')::BIGINT;
END;
$$;


--
-- TOC entry 314 (class 1255 OID 21788)
-- Name: get_song_details(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_song_details(song_id_param integer) RETURNS TABLE(song_title text, artists text, genres text, duration text, status text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.title,
        string_agg(DISTINCT a.name || ' (' || sa.role || ')', ', ' ORDER BY a.name) as artists,
        string_agg(DISTINCT g.name, ', ' ORDER BY g.name) as genres,
        s.duration,
        s.validation_status
    FROM metadata.songs s
    LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
    LEFT JOIN metadata.artists a ON sa.artist_id = a.id
    LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
    LEFT JOIN metadata.genres g ON sg.genre_id = g.id
    WHERE s.id = song_id_param
    GROUP BY s.id, s.title, s.duration, s.validation_status;
END;
$$;


--
-- TOC entry 315 (class 1255 OID 21817)
-- Name: get_song_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_song_stats() RETURNS TABLE(total_songs bigint, total_artists bigint, total_genres bigint, verified_songs bigint, unverified_songs bigint, pending_songs bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM metadata.songs)::BIGINT,
        (SELECT COUNT(*) FROM metadata.artists)::BIGINT,
        (SELECT COUNT(*) FROM metadata.genres)::BIGINT,
        (SELECT COUNT(*) FROM metadata.songs WHERE validation_status = 'verified')::BIGINT,
        (SELECT COUNT(*) FROM metadata.songs WHERE validation_status = 'unverified')::BIGINT,
        (SELECT COUNT(*) FROM metadata.songs WHERE validation_status = 'pending')::BIGINT;
END;
$$;


--
-- TOC entry 312 (class 1255 OID 21786)
-- Name: remove_song_artist(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_song_artist(song_id_param integer, artist_name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    artist_id_val integer;
    affected_rows integer;
BEGIN
    SELECT id INTO artist_id_val 
    FROM metadata.artists 
    WHERE name = artist_name;
    
    DELETE FROM metadata.song_artists 
    WHERE song_id = song_id_param AND artist_id = artist_id_val;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    RETURN format('Removed "%s" from song ID %s (%s relationships deleted)', 
                  artist_name, song_id_param, affected_rows);
END;
$$;


--
-- TOC entry 321 (class 1255 OID 21824)
-- Name: test_database_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.test_database_health() RETURNS TABLE(test_name text, test_result text, test_status text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        'Database Connection'::TEXT,
        'Connected successfully'::TEXT,
        'PASS'::TEXT
    UNION ALL
    SELECT
        'Songs Table'::TEXT,
        'Found ' || COUNT(*)::TEXT || ' songs',
        CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'WARN' END
    FROM metadata.songs
    UNION ALL
    SELECT
        'Artists Table'::TEXT,
        'Found ' || COUNT(*)::TEXT || ' artists',
        CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'WARN' END
    FROM metadata.artists
    UNION ALL
    SELECT
        'Genres Table'::TEXT,
        'Found ' || COUNT(*)::TEXT || ' genres',
        CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'WARN' END
    FROM metadata.genres;
END;
$$;


--
-- TOC entry 313 (class 1255 OID 21787)
-- Name: update_song_genres(integer, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_song_genres(song_id_param integer, genre_names text[]) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    genre_name text;
    genre_id_val integer;
    genre_count integer := 0;
BEGIN
    -- Remove all existing genres for this song
    DELETE FROM metadata.song_genres WHERE song_id = song_id_param;
    
    -- Add new genres
    FOREACH genre_name IN ARRAY genre_names
    LOOP
        -- Get or create genre
        SELECT id INTO genre_id_val 
        FROM metadata.genres 
        WHERE name = genre_name;
        
        IF genre_id_val IS NULL THEN
            INSERT INTO metadata.genres (name) 
            VALUES (genre_name) 
            RETURNING id INTO genre_id_val;
        END IF;
        
        -- Add the relationship
        INSERT INTO metadata.song_genres (song_id, genre_id) 
        VALUES (song_id_param, genre_id_val);
        
        genre_count := genre_count + 1;
    END LOOP;
    
    RETURN format('Updated genres for song ID %s: %s genres assigned', 
                  song_id_param, genre_count);
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 243 (class 1259 OID 20501)
-- Name: artists; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.artists (
    id integer NOT NULL,
    name text NOT NULL,
    isni character varying(16),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- TOC entry 254 (class 1259 OID 20548)
-- Name: song_artists; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.song_artists (
    song_id integer NOT NULL,
    artist_id integer NOT NULL,
    role character varying(30) DEFAULT 'primary'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- TOC entry 257 (class 1259 OID 20560)
-- Name: songs; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.songs (
    id integer NOT NULL,
    title text NOT NULL,
    duration text,
    is_explicit boolean DEFAULT false,
    is_ai_generated boolean DEFAULT false,
    copyright_master text,
    copyright_composition text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    validation_status character varying(20) DEFAULT 'unverified'::character varying NOT NULL,
    validation_notes text,
    isrc character varying(12),
    iswc character varying(11)
);


--
-- TOC entry 261 (class 1259 OID 21778)
-- Name: artist_song_roles; Type: VIEW; Schema: app; Owner: -
--

CREATE VIEW app.artist_song_roles AS
 SELECT sa.song_id,
    sa.artist_id,
    a.name AS artist_name,
    s.title AS song_title,
    sa.role,
    sa.created_at
   FROM ((metadata.song_artists sa
     JOIN metadata.artists a ON ((sa.artist_id = a.id)))
     JOIN metadata.songs s ON ((sa.song_id = s.id)));


--
-- TOC entry 222 (class 1259 OID 20429)
-- Name: favorites; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.favorites (
    user_id integer NOT NULL,
    song_id integer NOT NULL,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- TOC entry 223 (class 1259 OID 20433)
-- Name: playlist_songs; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.playlist_songs (
    playlist_id integer NOT NULL,
    song_id integer NOT NULL,
    "position" integer NOT NULL,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- TOC entry 224 (class 1259 OID 20437)
-- Name: playlists; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.playlists (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    description text,
    is_public boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- TOC entry 225 (class 1259 OID 20445)
-- Name: playlists_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.playlists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3826 (class 0 OID 0)
-- Dependencies: 225
-- Name: playlists_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.playlists_id_seq OWNED BY app.playlists.id;


--
-- TOC entry 226 (class 1259 OID 20446)
-- Name: plays; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.plays (
    id integer NOT NULL,
    user_id integer NOT NULL,
    song_id integer NOT NULL,
    played_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    play_duration_seconds integer,
    source character varying(20)
);


--
-- TOC entry 227 (class 1259 OID 20450)
-- Name: plays_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.plays_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3827 (class 0 OID 0)
-- Dependencies: 227
-- Name: plays_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.plays_id_seq OWNED BY app.plays.id;


--
-- TOC entry 249 (class 1259 OID 20527)
-- Name: genres; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.genres (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- TOC entry 256 (class 1259 OID 20557)
-- Name: song_genres; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.song_genres (
    song_id integer NOT NULL,
    genre_id integer NOT NULL
);


--
-- TOC entry 260 (class 1259 OID 21773)
-- Name: song_full_details; Type: VIEW; Schema: app; Owner: -
--

CREATE VIEW app.song_full_details AS
 SELECT s.id,
    s.title,
    s.duration,
    s.is_explicit,
    s.is_ai_generated,
    string_agg(DISTINCT a.name, ', '::text ORDER BY a.name) AS artists,
    string_agg(DISTINCT g.name, ', '::text ORDER BY g.name) AS genres,
    s.validation_status,
    s.created_at,
    s.updated_at
   FROM ((((metadata.songs s
     LEFT JOIN metadata.song_artists sa ON ((s.id = sa.song_id)))
     LEFT JOIN metadata.artists a ON ((sa.artist_id = a.id)))
     LEFT JOIN metadata.song_genres sg ON ((s.id = sg.song_id)))
     LEFT JOIN metadata.genres g ON ((sg.genre_id = g.id)))
  GROUP BY s.id, s.title, s.duration, s.is_explicit, s.is_ai_generated, s.validation_status, s.created_at, s.updated_at;


--
-- TOC entry 228 (class 1259 OID 20451)
-- Name: users; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.users (
    id integer NOT NULL,
    ada_address character varying(103) NOT NULL,
    username character varying(30),
    email character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_active_at timestamp with time zone
);


--
-- TOC entry 229 (class 1259 OID 20455)
-- Name: users_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3828 (class 0 OID 0)
-- Dependencies: 229
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.users_id_seq OWNED BY app.users.id;


--
-- TOC entry 230 (class 1259 OID 20456)
-- Name: assets; Type: TABLE; Schema: cip60; Owner: -
--

CREATE TABLE cip60.assets (
    id integer NOT NULL,
    policy_id character varying(56) NOT NULL,
    asset_name character varying(64) NOT NULL,
    indexed_at bigint NOT NULL,
    updated_at bigint,
    data_label integer DEFAULT 721 NOT NULL
);


--
-- TOC entry 231 (class 1259 OID 20460)
-- Name: assets_id_seq; Type: SEQUENCE; Schema: cip60; Owner: -
--

CREATE SEQUENCE cip60.assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3829 (class 0 OID 0)
-- Dependencies: 231
-- Name: assets_id_seq; Type: SEQUENCE OWNED BY; Schema: cip60; Owner: -
--

ALTER SEQUENCE cip60.assets_id_seq OWNED BY cip60.assets.id;


--
-- TOC entry 232 (class 1259 OID 20461)
-- Name: cip25; Type: TABLE; Schema: cip60; Owner: -
--

CREATE TABLE cip60.cip25 (
    asset_id integer NOT NULL,
    raw_metadata jsonb NOT NULL,
    tx_hash character varying(64) NOT NULL,
    slot_no bigint NOT NULL,
    mint_quantity bigint DEFAULT 0 NOT NULL,
    id integer NOT NULL
);


--
-- TOC entry 3830 (class 0 OID 0)
-- Dependencies: 232
-- Name: TABLE cip25; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON TABLE cip60.cip25 IS 'Stores every CIP-25 (721) mint event for music tokens, preserving metadata history';


--
-- TOC entry 3831 (class 0 OID 0)
-- Dependencies: 232
-- Name: COLUMN cip25.id; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON COLUMN cip60.cip25.id IS 'Unique identifier for each mint event';


--
-- TOC entry 233 (class 1259 OID 20467)
-- Name: cip25_asset_id_seq; Type: SEQUENCE; Schema: cip60; Owner: -
--

CREATE SEQUENCE cip60.cip25_asset_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3832 (class 0 OID 0)
-- Dependencies: 233
-- Name: cip25_asset_id_seq; Type: SEQUENCE OWNED BY; Schema: cip60; Owner: -
--

ALTER SEQUENCE cip60.cip25_asset_id_seq OWNED BY cip60.cip25.asset_id;


--
-- TOC entry 234 (class 1259 OID 20468)
-- Name: cip25_assets; Type: VIEW; Schema: cip60; Owner: -
--

CREATE VIEW cip60.cip25_assets AS
 SELECT a.id,
    a.policy_id,
    a.asset_name,
    convert_from(decode((a.asset_name)::text, 'hex'::text), 'UTF8'::name) AS name,
    c.raw_metadata
   FROM (cip60.assets a
     LEFT JOIN LATERAL ( SELECT cip25.raw_metadata
           FROM cip60.cip25
          WHERE (cip25.asset_id = a.id)
          ORDER BY cip25.slot_no DESC
         LIMIT 1) c ON (true))
  WHERE (a.data_label = 721);


--
-- TOC entry 235 (class 1259 OID 20473)
-- Name: cip25_id_seq; Type: SEQUENCE; Schema: cip60; Owner: -
--

CREATE SEQUENCE cip60.cip25_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3833 (class 0 OID 0)
-- Dependencies: 235
-- Name: cip25_id_seq; Type: SEQUENCE OWNED BY; Schema: cip60; Owner: -
--

ALTER SEQUENCE cip60.cip25_id_seq OWNED BY cip60.cip25.id;


--
-- TOC entry 236 (class 1259 OID 20474)
-- Name: cip68; Type: TABLE; Schema: cip60; Owner: -
--

CREATE TABLE cip60.cip68 (
    asset_id integer NOT NULL,
    slot_no bigint NOT NULL,
    tx_hash character varying(64) NOT NULL,
    datum_cbor text,
    mint_quantity bigint DEFAULT 0,
    id integer NOT NULL
);


--
-- TOC entry 3834 (class 0 OID 0)
-- Dependencies: 236
-- Name: TABLE cip68; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON TABLE cip60.cip68 IS 'Stores every CIP-68 mint event for music tokens, preserving datum history';


--
-- TOC entry 3835 (class 0 OID 0)
-- Dependencies: 236
-- Name: COLUMN cip68.id; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON COLUMN cip60.cip68.id IS 'Unique identifier for each mint event';


--
-- TOC entry 237 (class 1259 OID 20480)
-- Name: cip68_asset_id_seq; Type: SEQUENCE; Schema: cip60; Owner: -
--

CREATE SEQUENCE cip60.cip68_asset_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3836 (class 0 OID 0)
-- Dependencies: 237
-- Name: cip68_asset_id_seq; Type: SEQUENCE OWNED BY; Schema: cip60; Owner: -
--

ALTER SEQUENCE cip60.cip68_asset_id_seq OWNED BY cip60.cip68.asset_id;


--
-- TOC entry 259 (class 1259 OID 21764)
-- Name: cip68_assets; Type: VIEW; Schema: cip60; Owner: -
--

CREATE VIEW cip60.cip68_assets AS
 SELECT a.id,
    a.policy_id,
    a.asset_name,
    c.name,
    c.cbor_json
   FROM (cip60.assets a
     LEFT JOIN LATERAL ( SELECT cip60.decode_cbor_to_json(cip68.datum_cbor) AS cbor_json,
            (cip60.decode_cbor_to_json(cip68.datum_cbor) ->> 'name'::text) AS name
           FROM cip60.cip68
          WHERE (cip68.asset_id = a.id)
          ORDER BY cip68.slot_no DESC
         LIMIT 1) c ON (true))
  WHERE (a.data_label = 100);


--
-- TOC entry 238 (class 1259 OID 20486)
-- Name: cip68_id_seq; Type: SEQUENCE; Schema: cip60; Owner: -
--

CREATE SEQUENCE cip60.cip68_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3837 (class 0 OID 0)
-- Dependencies: 238
-- Name: cip68_id_seq; Type: SEQUENCE OWNED BY; Schema: cip60; Owner: -
--

ALTER SEQUENCE cip60.cip68_id_seq OWNED BY cip60.cip68.id;


--
-- TOC entry 239 (class 1259 OID 20487)
-- Name: holders; Type: TABLE; Schema: cip60; Owner: -
--

CREATE TABLE cip60.holders (
    asset_id bigint NOT NULL,
    holder_count bigint DEFAULT 0 NOT NULL,
    last_updated bigint
);


--
-- TOC entry 3838 (class 0 OID 0)
-- Dependencies: 239
-- Name: TABLE holders; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON TABLE cip60.holders IS 'Stores the number of unique addresses holding each CIP-60 music token asset';


--
-- TOC entry 3839 (class 0 OID 0)
-- Dependencies: 239
-- Name: COLUMN holders.asset_id; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON COLUMN cip60.holders.asset_id IS 'Foreign key reference to cip60.assets.id';


--
-- TOC entry 3840 (class 0 OID 0)
-- Dependencies: 239
-- Name: COLUMN holders.holder_count; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON COLUMN cip60.holders.holder_count IS 'Number of unique addresses holding this asset';


--
-- TOC entry 3841 (class 0 OID 0)
-- Dependencies: 239
-- Name: COLUMN holders.last_updated; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON COLUMN cip60.holders.last_updated IS 'Timestamp when the holder count was last updated from Blockfrost API';


--
-- TOC entry 240 (class 1259 OID 20491)
-- Name: indexer_state; Type: TABLE; Schema: cip60; Owner: -
--

CREATE TABLE cip60.indexer_state (
    id integer NOT NULL,
    last_slot bigint NOT NULL,
    last_block_hash character varying(64) NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- TOC entry 241 (class 1259 OID 20495)
-- Name: indexer_state_id_seq; Type: SEQUENCE; Schema: cip60; Owner: -
--

CREATE SEQUENCE cip60.indexer_state_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3842 (class 0 OID 0)
-- Dependencies: 241
-- Name: indexer_state_id_seq; Type: SEQUENCE OWNED BY; Schema: cip60; Owner: -
--

ALTER SEQUENCE cip60.indexer_state_id_seq OWNED BY cip60.indexer_state.id;


--
-- TOC entry 263 (class 1259 OID 21923)
-- Name: music_tokens; Type: VIEW; Schema: cip60; Owner: -
--

CREATE VIEW cip60.music_tokens AS
 SELECT id,
    policy_id,
    asset_name,
    name,
    metadata,
    data_label,
    cip60.asset_fingerprint((policy_id)::text, (asset_name)::text) AS asset_fingerprint,
    (cip60.extract_metadata_fields(metadata)).release_type AS release_type,
    (cip60.extract_metadata_fields(metadata)).image_urls AS image_urls
   FROM ( SELECT cip25_assets.id,
            cip25_assets.policy_id,
            cip25_assets.asset_name,
            cip25_assets.name,
            cip25_assets.raw_metadata AS metadata,
            721 AS data_label
           FROM cip60.cip25_assets
        UNION ALL
         SELECT cip68_assets.id,
            cip68_assets.policy_id,
            cip68_assets.asset_name,
            cip68_assets.name,
            cip68_assets.cbor_json AS metadata,
            100 AS data_label
           FROM cip60.cip68_assets) combined
  ORDER BY id;


--
-- TOC entry 242 (class 1259 OID 20496)
-- Name: processing_status; Type: TABLE; Schema: cip60; Owner: -
--

CREATE TABLE cip60.processing_status (
    asset_id integer NOT NULL,
    processed_at timestamp with time zone,
    has_valid_songs boolean DEFAULT false,
    status character varying(50) DEFAULT 'processed'::character varying
);


--
-- TOC entry 244 (class 1259 OID 20507)
-- Name: artists_id_seq; Type: SEQUENCE; Schema: metadata; Owner: -
--

CREATE SEQUENCE metadata.artists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3843 (class 0 OID 0)
-- Dependencies: 244
-- Name: artists_id_seq; Type: SEQUENCE OWNED BY; Schema: metadata; Owner: -
--

ALTER SEQUENCE metadata.artists_id_seq OWNED BY metadata.artists.id;


--
-- TOC entry 245 (class 1259 OID 20508)
-- Name: asset_images; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.asset_images (
    asset_id integer NOT NULL,
    image_id integer NOT NULL,
    is_primary boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- TOC entry 262 (class 1259 OID 21789)
-- Name: assets_songs; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.assets_songs (
    asset_id integer NOT NULL,
    song_id integer NOT NULL,
    is_primary boolean DEFAULT false,
    linked_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- TOC entry 246 (class 1259 OID 20513)
-- Name: audio_files; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.audio_files (
    id integer NOT NULL,
    song_id integer NOT NULL,
    file_url text NOT NULL,
    file_type character varying(10) NOT NULL,
    ipfs_cid text,
    is_encrypted boolean DEFAULT false,
    is_chunked boolean DEFAULT false,
    chunks text[],
    is_pinned boolean DEFAULT false NOT NULL
);


--
-- TOC entry 247 (class 1259 OID 20521)
-- Name: audio_files_id_seq; Type: SEQUENCE; Schema: metadata; Owner: -
--

CREATE SEQUENCE metadata.audio_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3844 (class 0 OID 0)
-- Dependencies: 247
-- Name: audio_files_id_seq; Type: SEQUENCE OWNED BY; Schema: metadata; Owner: -
--

ALTER SEQUENCE metadata.audio_files_id_seq OWNED BY metadata.audio_files.id;


--
-- TOC entry 248 (class 1259 OID 20522)
-- Name: contributor; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.contributor (
    id bigint NOT NULL,
    name text,
    ipi text,
    isni character varying(16)
);


--
-- TOC entry 250 (class 1259 OID 20532)
-- Name: genres_id_seq; Type: SEQUENCE; Schema: metadata; Owner: -
--

CREATE SEQUENCE metadata.genres_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3845 (class 0 OID 0)
-- Dependencies: 250
-- Name: genres_id_seq; Type: SEQUENCE OWNED BY; Schema: metadata; Owner: -
--

ALTER SEQUENCE metadata.genres_id_seq OWNED BY metadata.genres.id;


--
-- TOC entry 251 (class 1259 OID 20533)
-- Name: images; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.images (
    id integer NOT NULL,
    image_url text,
    image_type character varying(20),
    is_chunked boolean DEFAULT false,
    chunks text[],
    ipfs_cid text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL
);


--
-- TOC entry 252 (class 1259 OID 20541)
-- Name: images_id_seq; Type: SEQUENCE; Schema: metadata; Owner: -
--

CREATE SEQUENCE metadata.images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3846 (class 0 OID 0)
-- Dependencies: 252
-- Name: images_id_seq; Type: SEQUENCE OWNED BY; Schema: metadata; Owner: -
--

ALTER SEQUENCE metadata.images_id_seq OWNED BY metadata.images.id;


--
-- TOC entry 253 (class 1259 OID 20542)
-- Name: processing_status; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.processing_status (
    asset_id integer NOT NULL,
    processed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    has_valid_songs boolean DEFAULT false,
    status character varying(50) DEFAULT 'processed'::character varying
);


--
-- TOC entry 255 (class 1259 OID 20553)
-- Name: song_contributors; Type: TABLE; Schema: metadata; Owner: -
--

CREATE TABLE metadata.song_contributors (
    song_id integer NOT NULL,
    contributor_id bigint NOT NULL,
    role character varying(50) DEFAULT 'contributor'::character varying NOT NULL
);


--
-- TOC entry 258 (class 1259 OID 20570)
-- Name: songs_id_seq; Type: SEQUENCE; Schema: metadata; Owner: -
--

CREATE SEQUENCE metadata.songs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3847 (class 0 OID 0)
-- Dependencies: 258
-- Name: songs_id_seq; Type: SEQUENCE OWNED BY; Schema: metadata; Owner: -
--

ALTER SEQUENCE metadata.songs_id_seq OWNED BY metadata.songs.id;


--
-- TOC entry 3472 (class 2604 OID 20571)
-- Name: playlists id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.playlists ALTER COLUMN id SET DEFAULT nextval('app.playlists_id_seq'::regclass);


--
-- TOC entry 3476 (class 2604 OID 20572)
-- Name: plays id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.plays ALTER COLUMN id SET DEFAULT nextval('app.plays_id_seq'::regclass);


--
-- TOC entry 3478 (class 2604 OID 20573)
-- Name: users id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users ALTER COLUMN id SET DEFAULT nextval('app.users_id_seq'::regclass);


--
-- TOC entry 3480 (class 2604 OID 20574)
-- Name: assets id; Type: DEFAULT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.assets ALTER COLUMN id SET DEFAULT nextval('cip60.assets_id_seq'::regclass);


--
-- TOC entry 3482 (class 2604 OID 20575)
-- Name: cip25 asset_id; Type: DEFAULT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip25 ALTER COLUMN asset_id SET DEFAULT nextval('cip60.cip25_asset_id_seq'::regclass);


--
-- TOC entry 3484 (class 2604 OID 20576)
-- Name: cip25 id; Type: DEFAULT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip25 ALTER COLUMN id SET DEFAULT nextval('cip60.cip25_id_seq'::regclass);


--
-- TOC entry 3485 (class 2604 OID 20577)
-- Name: cip68 asset_id; Type: DEFAULT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip68 ALTER COLUMN asset_id SET DEFAULT nextval('cip60.cip68_asset_id_seq'::regclass);


--
-- TOC entry 3487 (class 2604 OID 20578)
-- Name: cip68 id; Type: DEFAULT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip68 ALTER COLUMN id SET DEFAULT nextval('cip60.cip68_id_seq'::regclass);


--
-- TOC entry 3489 (class 2604 OID 20579)
-- Name: indexer_state id; Type: DEFAULT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.indexer_state ALTER COLUMN id SET DEFAULT nextval('cip60.indexer_state_id_seq'::regclass);


--
-- TOC entry 3493 (class 2604 OID 20580)
-- Name: artists id; Type: DEFAULT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.artists ALTER COLUMN id SET DEFAULT nextval('metadata.artists_id_seq'::regclass);


--
-- TOC entry 3497 (class 2604 OID 20581)
-- Name: audio_files id; Type: DEFAULT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.audio_files ALTER COLUMN id SET DEFAULT nextval('metadata.audio_files_id_seq'::regclass);


--
-- TOC entry 3501 (class 2604 OID 20582)
-- Name: genres id; Type: DEFAULT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.genres ALTER COLUMN id SET DEFAULT nextval('metadata.genres_id_seq'::regclass);


--
-- TOC entry 3502 (class 2604 OID 20583)
-- Name: images id; Type: DEFAULT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.images ALTER COLUMN id SET DEFAULT nextval('metadata.images_id_seq'::regclass);


--
-- TOC entry 3512 (class 2604 OID 20584)
-- Name: songs id; Type: DEFAULT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.songs ALTER COLUMN id SET DEFAULT nextval('metadata.songs_id_seq'::regclass);


--
-- TOC entry 3521 (class 2606 OID 21548)
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (user_id, song_id);


--
-- TOC entry 3526 (class 2606 OID 21550)
-- Name: playlist_songs playlist_songs_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.playlist_songs
    ADD CONSTRAINT playlist_songs_pkey PRIMARY KEY (playlist_id, song_id);


--
-- TOC entry 3529 (class 2606 OID 21552)
-- Name: playlists playlists_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.playlists
    ADD CONSTRAINT playlists_pkey PRIMARY KEY (id);


--
-- TOC entry 3533 (class 2606 OID 21554)
-- Name: plays plays_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.plays
    ADD CONSTRAINT plays_pkey PRIMARY KEY (id);


--
-- TOC entry 3535 (class 2606 OID 21556)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 3537 (class 2606 OID 21558)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3539 (class 2606 OID 21560)
-- Name: users users_stake_address_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_stake_address_key UNIQUE (ada_address);


--
-- TOC entry 3541 (class 2606 OID 21562)
-- Name: users users_username_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- TOC entry 3554 (class 2606 OID 21564)
-- Name: cip25 cip25_pkey; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip25
    ADD CONSTRAINT cip25_pkey PRIMARY KEY (id);


--
-- TOC entry 3561 (class 2606 OID 21566)
-- Name: cip68 cip68_pkey; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip68
    ADD CONSTRAINT cip68_pkey PRIMARY KEY (id);


--
-- TOC entry 3568 (class 2606 OID 21568)
-- Name: holders holders_pkey; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.holders
    ADD CONSTRAINT holders_pkey PRIMARY KEY (asset_id);


--
-- TOC entry 3570 (class 2606 OID 21570)
-- Name: indexer_state indexer_state_pkey; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.indexer_state
    ADD CONSTRAINT indexer_state_pkey PRIMARY KEY (id);


--
-- TOC entry 3550 (class 2606 OID 21572)
-- Name: assets music_tokens_pkey; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.assets
    ADD CONSTRAINT music_tokens_pkey PRIMARY KEY (id);


--
-- TOC entry 3573 (class 2606 OID 21574)
-- Name: processing_status processing_status_pkey; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.processing_status
    ADD CONSTRAINT processing_status_pkey PRIMARY KEY (asset_id);


--
-- TOC entry 3559 (class 2606 OID 21576)
-- Name: cip25 unique_cip25_mint_event; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip25
    ADD CONSTRAINT unique_cip25_mint_event UNIQUE (asset_id, slot_no, tx_hash);


--
-- TOC entry 3848 (class 0 OID 0)
-- Dependencies: 3559
-- Name: CONSTRAINT unique_cip25_mint_event ON cip25; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON CONSTRAINT unique_cip25_mint_event ON cip60.cip25 IS 'Ensures each mint event per asset per slot/transaction is recorded only once';


--
-- TOC entry 3566 (class 2606 OID 21578)
-- Name: cip68 unique_cip68_mint_event; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip68
    ADD CONSTRAINT unique_cip68_mint_event UNIQUE (asset_id, slot_no, tx_hash);


--
-- TOC entry 3849 (class 0 OID 0)
-- Dependencies: 3566
-- Name: CONSTRAINT unique_cip68_mint_event ON cip68; Type: COMMENT; Schema: cip60; Owner: -
--

COMMENT ON CONSTRAINT unique_cip68_mint_event ON cip60.cip68 IS 'Ensures each mint event per asset per slot/transaction is recorded only once';


--
-- TOC entry 3552 (class 2606 OID 21580)
-- Name: assets unique_token; Type: CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.assets
    ADD CONSTRAINT unique_token UNIQUE (policy_id, asset_name);


--
-- TOC entry 3575 (class 2606 OID 21582)
-- Name: artists artists_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.artists
    ADD CONSTRAINT artists_pkey PRIMARY KEY (id);


--
-- TOC entry 3581 (class 2606 OID 21584)
-- Name: asset_images asset_images_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.asset_images
    ADD CONSTRAINT asset_images_pkey PRIMARY KEY (asset_id, image_id);


--
-- TOC entry 3634 (class 2606 OID 21795)
-- Name: assets_songs assets_songs_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.assets_songs
    ADD CONSTRAINT assets_songs_pkey PRIMARY KEY (asset_id, song_id);


--
-- TOC entry 3585 (class 2606 OID 21586)
-- Name: audio_files audio_files_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.audio_files
    ADD CONSTRAINT audio_files_pkey PRIMARY KEY (id);


--
-- TOC entry 3595 (class 2606 OID 21588)
-- Name: contributor contributor_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.contributor
    ADD CONSTRAINT contributor_pkey PRIMARY KEY (id);


--
-- TOC entry 3597 (class 2606 OID 21590)
-- Name: genres genres_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.genres
    ADD CONSTRAINT genres_pkey PRIMARY KEY (id);


--
-- TOC entry 3601 (class 2606 OID 21592)
-- Name: images images_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.images
    ADD CONSTRAINT images_pkey PRIMARY KEY (id);


--
-- TOC entry 3607 (class 2606 OID 21594)
-- Name: processing_status processing_status_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.processing_status
    ADD CONSTRAINT processing_status_pkey PRIMARY KEY (asset_id);


--
-- TOC entry 3615 (class 2606 OID 21596)
-- Name: song_artists song_artists_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_artists
    ADD CONSTRAINT song_artists_pkey PRIMARY KEY (song_id, artist_id, role);


--
-- TOC entry 3619 (class 2606 OID 21598)
-- Name: song_contributors song_contributors_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_contributors
    ADD CONSTRAINT song_contributors_pkey PRIMARY KEY (song_id, contributor_id, role);


--
-- TOC entry 3627 (class 2606 OID 21600)
-- Name: song_genres song_genres_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_genres
    ADD CONSTRAINT song_genres_pkey PRIMARY KEY (song_id, genre_id);


--
-- TOC entry 3632 (class 2606 OID 21602)
-- Name: songs songs_pkey; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.songs
    ADD CONSTRAINT songs_pkey PRIMARY KEY (id);


--
-- TOC entry 3579 (class 2606 OID 21604)
-- Name: artists unique_artist_isni; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.artists
    ADD CONSTRAINT unique_artist_isni UNIQUE (isni) DEFERRABLE INITIALLY DEFERRED;


--
-- TOC entry 3591 (class 2606 OID 21607)
-- Name: audio_files unique_file_url; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.audio_files
    ADD CONSTRAINT unique_file_url UNIQUE (file_url);


--
-- TOC entry 3603 (class 2606 OID 21609)
-- Name: images unique_image_ipfs; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.images
    ADD CONSTRAINT unique_image_ipfs UNIQUE (ipfs_cid);


--
-- TOC entry 3605 (class 2606 OID 21611)
-- Name: images unique_image_url; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.images
    ADD CONSTRAINT unique_image_url UNIQUE (image_url);


--
-- TOC entry 3593 (class 2606 OID 21613)
-- Name: audio_files unique_song_file; Type: CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.audio_files
    ADD CONSTRAINT unique_song_file UNIQUE (song_id, file_type);


--
-- TOC entry 3522 (class 1259 OID 21614)
-- Name: idx_favorites_count; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_favorites_count ON app.favorites USING btree (song_id);


--
-- TOC entry 3523 (class 1259 OID 21615)
-- Name: idx_favorites_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_favorites_user ON app.favorites USING btree (user_id);


--
-- TOC entry 3524 (class 1259 OID 21616)
-- Name: idx_playlist_songs_playlist; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_playlist_songs_playlist ON app.playlist_songs USING btree (playlist_id);


--
-- TOC entry 3527 (class 1259 OID 21617)
-- Name: idx_playlists_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_playlists_user ON app.playlists USING btree (user_id);


--
-- TOC entry 3530 (class 1259 OID 21618)
-- Name: idx_plays_count; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_plays_count ON app.plays USING btree (song_id);


--
-- TOC entry 3531 (class 1259 OID 21619)
-- Name: idx_plays_user; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_plays_user ON app.plays USING btree (user_id);


--
-- TOC entry 3542 (class 1259 OID 30237)
-- Name: idx_assets_id; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_assets_id ON cip60.assets USING btree (id);


--
-- TOC entry 3543 (class 1259 OID 30235)
-- Name: idx_assets_id_indexed_at; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_assets_id_indexed_at ON cip60.assets USING btree (id, indexed_at DESC);


--
-- TOC entry 3544 (class 1259 OID 30234)
-- Name: idx_assets_indexed_at; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_assets_indexed_at ON cip60.assets USING btree (indexed_at DESC);


--
-- TOC entry 3545 (class 1259 OID 30236)
-- Name: idx_assets_policy_asset; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_assets_policy_asset ON cip60.assets USING btree (policy_id, asset_name);


--
-- TOC entry 3555 (class 1259 OID 21620)
-- Name: idx_cip25_asset_id; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip25_asset_id ON cip60.cip25 USING btree (asset_id);


--
-- TOC entry 3556 (class 1259 OID 21621)
-- Name: idx_cip25_asset_slot; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip25_asset_slot ON cip60.cip25 USING btree (asset_id, slot_no DESC);


--
-- TOC entry 3557 (class 1259 OID 21622)
-- Name: idx_cip25_slot_no; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip25_slot_no ON cip60.cip25 USING btree (slot_no DESC);


--
-- TOC entry 3546 (class 1259 OID 30118)
-- Name: idx_cip60_assets_id; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip60_assets_id ON cip60.assets USING btree (id);


--
-- TOC entry 3547 (class 1259 OID 30117)
-- Name: idx_cip60_assets_indexed_at; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip60_assets_indexed_at ON cip60.assets USING btree (indexed_at DESC);


--
-- TOC entry 3548 (class 1259 OID 30210)
-- Name: idx_cip60_assets_indexed_at_desc; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip60_assets_indexed_at_desc ON cip60.assets USING btree (indexed_at DESC);


--
-- TOC entry 3562 (class 1259 OID 21623)
-- Name: idx_cip68_asset_id; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip68_asset_id ON cip60.cip68 USING btree (asset_id);


--
-- TOC entry 3563 (class 1259 OID 21624)
-- Name: idx_cip68_asset_slot; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip68_asset_slot ON cip60.cip68 USING btree (asset_id, slot_no DESC);


--
-- TOC entry 3564 (class 1259 OID 21625)
-- Name: idx_cip68_slot_no; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_cip68_slot_no ON cip60.cip68 USING btree (slot_no DESC);


--
-- TOC entry 3571 (class 1259 OID 21626)
-- Name: idx_processing_status_coverage; Type: INDEX; Schema: cip60; Owner: -
--

CREATE INDEX idx_processing_status_coverage ON cip60.processing_status USING btree (asset_id);


--
-- TOC entry 3576 (class 1259 OID 30207)
-- Name: idx_artists_id_name; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_artists_id_name ON metadata.artists USING btree (id, name);


--
-- TOC entry 3577 (class 1259 OID 30247)
-- Name: idx_artists_name_lower; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_artists_name_lower ON metadata.artists USING btree (lower(name));


--
-- TOC entry 3582 (class 1259 OID 21627)
-- Name: idx_asset_images_asset; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_asset_images_asset ON metadata.asset_images USING btree (asset_id);


--
-- TOC entry 3583 (class 1259 OID 21628)
-- Name: idx_asset_images_image; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_asset_images_image ON metadata.asset_images USING btree (image_id);


--
-- TOC entry 3635 (class 1259 OID 21806)
-- Name: idx_assets_songs_asset; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_assets_songs_asset ON metadata.assets_songs USING btree (asset_id);


--
-- TOC entry 3636 (class 1259 OID 21807)
-- Name: idx_assets_songs_asset_coverage; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_assets_songs_asset_coverage ON metadata.assets_songs USING btree (asset_id);


--
-- TOC entry 3637 (class 1259 OID 30238)
-- Name: idx_assets_songs_asset_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_assets_songs_asset_id ON metadata.assets_songs USING btree (asset_id);


--
-- TOC entry 3638 (class 1259 OID 30240)
-- Name: idx_assets_songs_asset_primary; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_assets_songs_asset_primary ON metadata.assets_songs USING btree (asset_id, is_primary) WHERE (is_primary = true);


--
-- TOC entry 3639 (class 1259 OID 21808)
-- Name: idx_assets_songs_coverage; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_assets_songs_coverage ON metadata.assets_songs USING btree (song_id);


--
-- TOC entry 3640 (class 1259 OID 21809)
-- Name: idx_assets_songs_song; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_assets_songs_song ON metadata.assets_songs USING btree (song_id);


--
-- TOC entry 3641 (class 1259 OID 21810)
-- Name: idx_assets_songs_song_coverage; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_assets_songs_song_coverage ON metadata.assets_songs USING btree (song_id);


--
-- TOC entry 3642 (class 1259 OID 30239)
-- Name: idx_assets_songs_song_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_assets_songs_song_id ON metadata.assets_songs USING btree (song_id);


--
-- TOC entry 3586 (class 1259 OID 30246)
-- Name: idx_audio_files_ipfs_cid; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_audio_files_ipfs_cid ON metadata.audio_files USING btree (ipfs_cid) WHERE (ipfs_cid IS NOT NULL);


--
-- TOC entry 3587 (class 1259 OID 21629)
-- Name: idx_audio_files_song_coverage; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_audio_files_song_coverage ON metadata.audio_files USING btree (song_id);


--
-- TOC entry 3588 (class 1259 OID 30245)
-- Name: idx_audio_files_song_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_audio_files_song_id ON metadata.audio_files USING btree (song_id);


--
-- TOC entry 3589 (class 1259 OID 30205)
-- Name: idx_audio_files_song_id_ipfs; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_audio_files_song_id_ipfs ON metadata.audio_files USING btree (song_id, ipfs_cid);


--
-- TOC entry 3598 (class 1259 OID 30209)
-- Name: idx_genres_id_name; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_genres_id_name ON metadata.genres USING btree (id, name);


--
-- TOC entry 3599 (class 1259 OID 30249)
-- Name: idx_genres_name; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_genres_name ON metadata.genres USING btree (name);


--
-- TOC entry 3643 (class 1259 OID 30105)
-- Name: idx_metadata_assets_songs_asset_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_metadata_assets_songs_asset_id ON metadata.assets_songs USING btree (asset_id);


--
-- TOC entry 3644 (class 1259 OID 30113)
-- Name: idx_metadata_assets_songs_primary; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_metadata_assets_songs_primary ON metadata.assets_songs USING btree (asset_id, is_primary) WHERE (is_primary = true);


--
-- TOC entry 3645 (class 1259 OID 30106)
-- Name: idx_metadata_assets_songs_song_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_metadata_assets_songs_song_id ON metadata.assets_songs USING btree (song_id);


--
-- TOC entry 3608 (class 1259 OID 21630)
-- Name: idx_song_artists_artist; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_artists_artist ON metadata.song_artists USING btree (artist_id);


--
-- TOC entry 3609 (class 1259 OID 30241)
-- Name: idx_song_artists_artist_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_artists_artist_id ON metadata.song_artists USING btree (artist_id);


--
-- TOC entry 3610 (class 1259 OID 21631)
-- Name: idx_song_artists_song; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_artists_song ON metadata.song_artists USING btree (song_id);


--
-- TOC entry 3611 (class 1259 OID 30242)
-- Name: idx_song_artists_song_artist; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_artists_song_artist ON metadata.song_artists USING btree (song_id, artist_id);


--
-- TOC entry 3612 (class 1259 OID 30115)
-- Name: idx_song_artists_song_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_artists_song_id ON metadata.song_artists USING btree (song_id, artist_id);


--
-- TOC entry 3613 (class 1259 OID 30206)
-- Name: idx_song_artists_song_id_artist; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_artists_song_id_artist ON metadata.song_artists USING btree (song_id, artist_id);


--
-- TOC entry 3616 (class 1259 OID 21632)
-- Name: idx_song_contributors_contributor; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_contributors_contributor ON metadata.song_contributors USING btree (contributor_id);


--
-- TOC entry 3617 (class 1259 OID 21633)
-- Name: idx_song_contributors_song; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_contributors_song ON metadata.song_contributors USING btree (song_id);


--
-- TOC entry 3620 (class 1259 OID 21634)
-- Name: idx_song_genres_genre; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_genres_genre ON metadata.song_genres USING btree (genre_id);


--
-- TOC entry 3621 (class 1259 OID 30243)
-- Name: idx_song_genres_genre_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_genres_genre_id ON metadata.song_genres USING btree (genre_id);


--
-- TOC entry 3622 (class 1259 OID 21635)
-- Name: idx_song_genres_song; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_genres_song ON metadata.song_genres USING btree (song_id);


--
-- TOC entry 3623 (class 1259 OID 30244)
-- Name: idx_song_genres_song_genre; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_genres_song_genre ON metadata.song_genres USING btree (song_id, genre_id);


--
-- TOC entry 3624 (class 1259 OID 30116)
-- Name: idx_song_genres_song_id; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_genres_song_id ON metadata.song_genres USING btree (song_id, genre_id);


--
-- TOC entry 3625 (class 1259 OID 30208)
-- Name: idx_song_genres_song_id_genre; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_song_genres_song_id_genre ON metadata.song_genres USING btree (song_id, genre_id);


--
-- TOC entry 3628 (class 1259 OID 30211)
-- Name: idx_songs_flags_title; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_songs_flags_title ON metadata.songs USING btree (id, is_explicit, is_ai_generated, title);


--
-- TOC entry 3629 (class 1259 OID 30114)
-- Name: idx_songs_id_flags; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_songs_id_flags ON metadata.songs USING btree (id, is_explicit, is_ai_generated, title);


--
-- TOC entry 3630 (class 1259 OID 30248)
-- Name: idx_songs_title_lower; Type: INDEX; Schema: metadata; Owner: -
--

CREATE INDEX idx_songs_title_lower ON metadata.songs USING btree (lower(title));


--
-- TOC entry 3646 (class 2606 OID 21636)
-- Name: favorites favorites_song_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.favorites
    ADD CONSTRAINT favorites_song_id_fkey FOREIGN KEY (song_id) REFERENCES metadata.songs(id) ON DELETE CASCADE;


--
-- TOC entry 3647 (class 2606 OID 21641)
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- TOC entry 3648 (class 2606 OID 21646)
-- Name: playlist_songs playlist_songs_playlist_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.playlist_songs
    ADD CONSTRAINT playlist_songs_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES app.playlists(id) ON DELETE CASCADE;


--
-- TOC entry 3649 (class 2606 OID 21651)
-- Name: playlist_songs playlist_songs_song_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.playlist_songs
    ADD CONSTRAINT playlist_songs_song_id_fkey FOREIGN KEY (song_id) REFERENCES metadata.songs(id) ON DELETE CASCADE;


--
-- TOC entry 3650 (class 2606 OID 21656)
-- Name: playlists playlists_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.playlists
    ADD CONSTRAINT playlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- TOC entry 3651 (class 2606 OID 21661)
-- Name: plays plays_song_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.plays
    ADD CONSTRAINT plays_song_id_fkey FOREIGN KEY (song_id) REFERENCES metadata.songs(id) ON DELETE CASCADE;


--
-- TOC entry 3652 (class 2606 OID 21666)
-- Name: plays plays_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.plays
    ADD CONSTRAINT plays_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- TOC entry 3653 (class 2606 OID 21671)
-- Name: cip25 asset_id; Type: FK CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip25
    ADD CONSTRAINT asset_id FOREIGN KEY (asset_id) REFERENCES cip60.assets(id) NOT VALID;


--
-- TOC entry 3654 (class 2606 OID 21676)
-- Name: cip68 asset_id; Type: FK CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.cip68
    ADD CONSTRAINT asset_id FOREIGN KEY (asset_id) REFERENCES cip60.assets(id) NOT VALID;


--
-- TOC entry 3655 (class 2606 OID 21681)
-- Name: holders holders_asset_id_fkey; Type: FK CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.holders
    ADD CONSTRAINT holders_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES cip60.assets(id) ON DELETE CASCADE;


--
-- TOC entry 3656 (class 2606 OID 21686)
-- Name: processing_status processing_status_asset_id_fkey; Type: FK CONSTRAINT; Schema: cip60; Owner: -
--

ALTER TABLE ONLY cip60.processing_status
    ADD CONSTRAINT processing_status_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES cip60.assets(id) ON DELETE CASCADE;


--
-- TOC entry 3657 (class 2606 OID 21691)
-- Name: asset_images asset_images_asset_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.asset_images
    ADD CONSTRAINT asset_images_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES cip60.assets(id) ON DELETE CASCADE;


--
-- TOC entry 3658 (class 2606 OID 21696)
-- Name: asset_images asset_images_image_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.asset_images
    ADD CONSTRAINT asset_images_image_id_fkey FOREIGN KEY (image_id) REFERENCES metadata.images(id) ON DELETE CASCADE;


--
-- TOC entry 3667 (class 2606 OID 21796)
-- Name: assets_songs assets_songs_asset_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.assets_songs
    ADD CONSTRAINT assets_songs_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES cip60.assets(id) ON DELETE CASCADE;


--
-- TOC entry 3668 (class 2606 OID 21801)
-- Name: assets_songs assets_songs_song_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.assets_songs
    ADD CONSTRAINT assets_songs_song_id_fkey FOREIGN KEY (song_id) REFERENCES metadata.songs(id) ON DELETE CASCADE;


--
-- TOC entry 3659 (class 2606 OID 21701)
-- Name: audio_files audio_files_song_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.audio_files
    ADD CONSTRAINT audio_files_song_id_fkey FOREIGN KEY (song_id) REFERENCES metadata.songs(id) ON DELETE CASCADE;


--
-- TOC entry 3660 (class 2606 OID 21706)
-- Name: processing_status processing_status_asset_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.processing_status
    ADD CONSTRAINT processing_status_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES cip60.assets(id) ON DELETE CASCADE;


--
-- TOC entry 3661 (class 2606 OID 21711)
-- Name: song_artists song_artists_artist_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_artists
    ADD CONSTRAINT song_artists_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES metadata.artists(id) ON DELETE CASCADE;


--
-- TOC entry 3662 (class 2606 OID 21716)
-- Name: song_artists song_artists_song_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_artists
    ADD CONSTRAINT song_artists_song_id_fkey FOREIGN KEY (song_id) REFERENCES metadata.songs(id) ON DELETE CASCADE;


--
-- TOC entry 3663 (class 2606 OID 21721)
-- Name: song_contributors song_contributors_contributor_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_contributors
    ADD CONSTRAINT song_contributors_contributor_id_fkey FOREIGN KEY (contributor_id) REFERENCES metadata.contributor(id) ON DELETE CASCADE;


--
-- TOC entry 3664 (class 2606 OID 21726)
-- Name: song_contributors song_contributors_song_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_contributors
    ADD CONSTRAINT song_contributors_song_id_fkey FOREIGN KEY (song_id) REFERENCES metadata.songs(id) ON DELETE CASCADE;


--
-- TOC entry 3665 (class 2606 OID 21731)
-- Name: song_genres song_genres_genre_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_genres
    ADD CONSTRAINT song_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES metadata.genres(id) ON DELETE CASCADE;


--
-- TOC entry 3666 (class 2606 OID 21736)
-- Name: song_genres song_genres_song_id_fkey; Type: FK CONSTRAINT; Schema: metadata; Owner: -
--

ALTER TABLE ONLY metadata.song_genres
    ADD CONSTRAINT song_genres_song_id_fkey FOREIGN KEY (song_id) REFERENCES metadata.songs(id) ON DELETE CASCADE;


-- Completed on 2025-12-26 09:27:48

--
-- PostgreSQL database dump complete
--

