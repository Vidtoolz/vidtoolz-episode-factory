#!/usr/bin/env python3
"""Narrow official-API adapter for the disposable Scorecraft P7 timeline.

Input and output are JSON files supplied as argv. This script never chooses a
library, opens an existing saved project, evaluates project data as code, or
deletes a project outside the unique P7 prefix.
"""
import json
import hashlib
import os
import sys

P7_PREFIX = "VIDTOOLZ_SCORECRAFT_P7_ACCEPTANCE_"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def source_path(item):
    return str(item.GetClipProperty("File Path") or "")


def sha256_file(filename):
    digest = hashlib.sha256()
    with open(filename, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def add_tracks(timeline, track_type, count):
    while int(timeline.GetTrackCount(track_type) or 0) < count:
        require(timeline.AddTrack(track_type), f"Could not add Resolve {track_type} track")


def append(media_pool, item, media_type, track, record_frame):
    result = media_pool.AppendToTimeline([{
        "mediaPoolItem": item, "mediaType": media_type,
        "trackIndex": track, "recordFrame": record_frame,
    }])
    require(result and len(result) == 1, "Resolve did not create the requested timeline clip")
    return result[0]


def main():
    require(len(sys.argv) == 3, "Usage: scorecraft-resolve-driver.py input.json output.json")
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    project_name = str(spec.get("project_name", ""))
    require(project_name.startswith(P7_PREFIX), "Disposable project name lacks the required P7 prefix")
    require(os.path.isdir(spec["fixture_root"]), "Fixture root is missing")
    require(os.path.isdir(spec["render_dir"]), "Render directory is missing")

    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp("Resolve")
    require(resolve is not None, "Resolve scripting connection unavailable")
    manager = resolve.GetProjectManager()
    require(manager is not None, "Resolve ProjectManager unavailable")
    database = manager.GetCurrentDatabase() or {}
    databases = manager.GetDatabaseList() or []
    projects_before = manager.GetProjectListInCurrentFolder() or []
    require(database.get("DbType") == "Disk" and database.get("DbName") == "Local Database", "P7 requires its isolated local disk library")
    require(len(databases) == 1 and databases[0].get("DbType") == "Disk", "P7 isolation preflight found another project library")
    require(len(projects_before) == 0, "P7 isolation preflight found an existing saved project")
    require(project_name not in projects_before, "Disposable Resolve project name collision")

    project = None
    cleanup = {"attempted": False, "deleted": False}
    result = {}
    try:
        project = manager.CreateProject(project_name, spec["fixture_root"])
        require(project is not None, "Resolve could not create the disposable project")
        rate = spec["frame_rate"]
        rate_value = rate["numerator"] / rate["denominator"]
        rate_setting = str(rate_value).rstrip("0").rstrip(".") if rate_value % 1 else str(int(rate_value))
        for key, value in {
            "timelineFrameRate": rate_setting,
            "timelineResolutionWidth": str(spec["width"]),
            "timelineResolutionHeight": str(spec["height"]),
        }.items():
            require(project.SetSetting(key, value), f"Resolve rejected project setting {key}={value}")

        media_storage = resolve.GetMediaStorage()
        media_pool = project.GetMediaPool()
        require(media_storage is not None and media_pool is not None, "Resolve media interfaces unavailable")
        expected_paths = [spec["video_path"], spec["narration_path"], spec["music_path"]]
        imported = media_storage.AddItemListToMediaPool(expected_paths) or []
        by_path = {os.path.realpath(source_path(item)): item for item in imported}
        require(all(os.path.realpath(item) in by_path for item in expected_paths), "Resolve did not import every exact P7 source")

        timeline = media_pool.CreateEmptyTimeline(spec["timeline_name"])
        require(timeline is not None and project.SetCurrentTimeline(timeline), "Resolve could not create/select the disposable timeline")
        require(timeline.SetStartTimecode(spec["timeline_start_timecode"]), "Resolve rejected the P6 timeline start timecode")
        add_tracks(timeline, "video", 1)
        add_tracks(timeline, "audio", 2)
        timeline.SetTrackName("video", 1, "P7 Video")
        timeline.SetTrackName("audio", 1, "Narration")
        timeline.SetTrackName("audio", 2, "Scorecraft Music")
        absolute_start = int(timeline.GetStartFrame())
        append(media_pool, by_path[os.path.realpath(spec["video_path"])], 1, 1, absolute_start)
        append(media_pool, by_path[os.path.realpath(spec["narration_path"])], 2, 1, absolute_start + int(spec["narration_start_frame"]))
        append(media_pool, by_path[os.path.realpath(spec["music_path"])], 2, 2, absolute_start + int(spec["music_start_frame"]))
        for marker in spec["markers"]:
            require(timeline.AddMarker(int(marker["frame"]), "Green", str(marker["name"]), "Scorecraft P7 cue", max(1, int(marker["duration_frames"])), str(marker["cue_id"])), f"Resolve rejected cue marker {marker['cue_id']}")

        clips = []
        path_kinds = {
            os.path.realpath(spec["video_path"]): "video",
            os.path.realpath(spec["narration_path"]): "narration",
            os.path.realpath(spec["music_path"]): "music",
        }
        for media_type in ("video", "audio"):
            for track_index in range(1, int(timeline.GetTrackCount(media_type) or 0) + 1):
                for item in timeline.GetItemListInTrack(media_type, track_index) or []:
                    pool_item = item.GetMediaPoolItem()
                    item_path = os.path.realpath(source_path(pool_item))
                    require(item_path in path_kinds, f"Resolve timeline referenced unexpected media: {item_path}")
                    properties = item.GetProperty() or {}
                    clips.append({
                        "source_kind": path_kinds[item_path], "source_path": item_path,
                        "media_type": media_type, "track_index": track_index,
                        "start_frame": int(round(float(item.GetStart()))) - absolute_start,
                        "duration_frames": int(round(float(item.GetDuration()))),
                        "speed_percent": float(properties.get("Speed", 100)),
                    })
        markers = []
        for frame, marker in (timeline.GetMarkers() or {}).items():
            markers.append({
                "cue_id": str(marker.get("customData", "")), "name": str(marker.get("name", "")),
                "frame": int(round(float(frame))), "duration_frames": int(round(float(marker.get("duration", 1)))),
            })
        evidence = {
            "schema_version": 1, "role": "scorecraft_resolve_timeline_readback",
            "resolve_integration_identity": spec["resolve_integration_identity"],
            "frame_rate": rate, "timeline_start_timecode": str(timeline.GetStartTimecode()),
            "timeline_start_frame": absolute_start,
            "timeline_duration_frames": int(timeline.GetEndFrame()) - absolute_start,
            "clips": clips, "markers": markers,
        }
        # Fail the external application gate closed before rendering. Node will
        # independently repeat canonical validation and hashing after readback.
        by_kind = {kind: [clip for clip in clips if clip["source_kind"] == kind] for kind in ("video", "narration", "music")}
        require(all(len(by_kind[kind]) == 1 for kind in by_kind), "Disposable timeline must contain exactly one video, narration, and music clip")
        for kind, expected_hash in (("video", spec["video_sha256"]), ("narration", spec["narration_sha256"]), ("music", spec["music_sha256"])):
            require(sha256_file(by_kind[kind][0]["source_path"]) == expected_hash, f"Resolve timeline {kind} source hash does not match authority")
            require(by_kind[kind][0]["speed_percent"] == 100, f"Resolve timeline {kind} source was retimed")
        require(by_kind["music"][0]["start_frame"] == int(spec["music_start_frame"]), "Resolve timeline music placement differs from P6")
        require(by_kind["narration"][0]["start_frame"] == int(spec["narration_start_frame"]), "Resolve timeline narration placement differs from P6")
        expected_markers = sorted((str(m["cue_id"]), str(m["name"]), int(m["frame"]), int(m["duration_frames"])) for m in spec["markers"])
        actual_markers = sorted((m["cue_id"], m["name"], m["frame"], m["duration_frames"]) for m in markers)
        require(actual_markers == expected_markers, "Resolve cue-marker readback differs from P6")
        require(evidence["timeline_start_timecode"] == spec["timeline_start_timecode"], "Resolve timeline start timecode differs from P6")
        require(abs(evidence["timeline_duration_frames"] - int(spec["program_duration_frames"])) <= int(spec["duration_tolerance_frames"]), "Resolve timeline duration differs from P6")
        result.update({
            "product": resolve.GetProductName(), "version": resolve.GetVersionString(),
            "database": database, "projects_before": projects_before,
            "project_name": project_name, "timeline_name": timeline.GetName(),
            "evidence": evidence,
        })
        # Node validates readback source paths and streams their hashes before it
        # records semantic evidence. Rendering happens only after this readback.
        evidence_path = spec["pre_render_evidence_path"]
        with open(evidence_path, "x", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, sort_keys=True)
            handle.write("\n")

        quick_presets = project.GetQuickExportRenderPresets() or []
        require("H.264 Master" in quick_presets, "Resolve H.264 Master quick-export preset is unavailable")
        status = project.RenderWithQuickExport("H.264 Master", {
            "TargetDir": spec["render_dir"], "CustomName": spec["render_name"],
        }) or {}
        require(status.get("JobStatus") == "Render Complete", f"Resolve quick export did not complete: {status}")
        result["render_job_id"] = "quick-export:H.264 Master"
        result["render_status"] = status
        result["render_dir"] = spec["render_dir"]
        result["success"] = True
    finally:
        if project is not None:
            cleanup["attempted"] = True
            manager.CloseProject(project)
            cleanup["deleted"] = bool(manager.DeleteProject(project_name))
        result["cleanup"] = cleanup
        with open(sys.argv[2], "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, sort_keys=True)
            handle.write("\n")
    require(cleanup["deleted"], "Resolve disposable project cleanup failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(f"SCORECRAFT_P7_RESOLVE_ERROR: {error}\n")
        sys.exit(1)
