#!/usr/bin/env python3
"""P8-only fixture controller; destructive actions require isolated P8 prefix."""
import hashlib
import json
import os
import sys

PREFIX = "VIDTOOLZ_SCORECRAFT_P8_ACCEPTANCE_"


def require(value, message):
    if not value:
        raise RuntimeError(message)


def path_of(item):
    return os.path.realpath(str(item.GetClipProperty("File Path") or ""))


def sha256_file(filename):
    digest = hashlib.sha256()
    with open(filename, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_tracks(timeline, kind, count):
    while int(timeline.GetTrackCount(kind) or 0) < count:
        require(timeline.AddTrack(kind), f"Could not add {kind} track")


def append(pool, item, media_type, track, record_frame):
    result = pool.AppendToTimeline([{"mediaPoolItem": item, "mediaType": media_type, "trackIndex": track, "recordFrame": record_frame}]) or []
    require(len(result) == 1, "Resolve fixture append failed")


def timeline_by_name(project, name):
    count = int(project.GetTimelineCount() or 0)
    require(count <= 32, "P8 fixture timeline bound exceeded")
    return next((project.GetTimelineByIndex(index) for index in range(1, count + 1) if project.GetTimelineByIndex(index).GetName() == name), None)


def snapshot(timeline):
    start = int(timeline.GetStartFrame())
    result = {"name": str(timeline.GetName()), "unique_id": str(timeline.GetUniqueId()), "video": [], "audio": [], "markers": []}
    for kind in ("video", "audio"):
        for track in range(1, int(timeline.GetTrackCount(kind) or 0) + 1):
            for item in timeline.GetItemListInTrack(kind, track) or []:
                source = path_of(item.GetMediaPoolItem())
                result[kind].append({"track": track, "source_sha256": sha256_file(source), "start": int(round(float(item.GetStart()))) - start, "duration": int(round(float(item.GetDuration())))})
    for frame, marker in (timeline.GetMarkers() or {}).items():
        result["markers"].append({"frame": int(round(float(frame))), "name": str(marker.get("name", "")), "custom_data": str(marker.get("customData", ""))})
    for key in ("video", "audio", "markers"):
        result[key].sort(key=lambda value: json.dumps(value, sort_keys=True))
    return result


def main():
    require(len(sys.argv) == 3, "Usage: scorecraft-resolve-production-fixture.py input.json output.json")
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    operation = str(spec.get("operation", ""))
    require(operation in {"setup", "select", "mutate_stale", "cleanup"}, "Unsupported P8 fixture operation")
    project_name = str(spec.get("project_name", ""))
    require(project_name.startswith(PREFIX), "P8 fixture project lacks required prefix")
    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp("Resolve"); require(resolve is not None, "Resolve scripting unavailable")
    manager = resolve.GetProjectManager(); require(manager is not None, "Resolve ProjectManager unavailable")
    database = manager.GetCurrentDatabase() or {}; databases = manager.GetDatabaseList() or []
    require(database.get("DbType") == "Disk" and database.get("DbName") == "Local Database" and len(databases) == 1, "P8 fixture is not in the isolated disk library")
    result = {"operation": operation, "project_name": project_name}
    if operation == "setup":
        require(not (manager.GetProjectListInCurrentFolder() or []), "P8 isolated library is not empty")
        project = manager.CreateProject(project_name, spec["fixture_root"]); require(project is not None, "Could not create P8 fixture project")
        for key, value in {"timelineFrameRate": "24", "timelineResolutionWidth": "1080", "timelineResolutionHeight": "1920"}.items():
            require(project.SetSetting(key, value), f"Resolve rejected {key}")
        storage = resolve.GetMediaStorage(); pool = project.GetMediaPool()
        paths = spec["video_paths"] + [spec["narration_path"], spec["unrelated_audio_path"], spec["unknown_audio_path"]]
        imported = storage.AddItemListToMediaPool(paths) or []
        by_path = {path_of(item): item for item in imported}; require(all(os.path.realpath(value) in by_path for value in paths), "P8 fixture media import incomplete")
        timeline = pool.CreateEmptyTimeline(spec["source_timeline_name"]); require(timeline is not None and project.SetCurrentTimeline(timeline), "Could not create source timeline")
        require(timeline.SetStartTimecode("01:00:00:00"), "Could not set source start timecode")
        add_tracks(timeline, "video", 1); add_tracks(timeline, "audio", 4)
        timeline.SetTrackName("video", 1, "Edited Picture"); timeline.SetTrackName("audio", 1, "Narration")
        timeline.SetTrackName("audio", 2, "Effects"); timeline.SetTrackName("audio", 3, "Room Tone"); timeline.SetTrackName("audio", 4, "Scorecraft Music")
        absolute = int(timeline.GetStartFrame())
        for index, video in enumerate(spec["video_paths"]): append(pool, by_path[os.path.realpath(video)], 1, 1, absolute + index * 32)
        append(pool, by_path[os.path.realpath(spec["narration_path"])], 2, 1, absolute + 24)
        append(pool, by_path[os.path.realpath(spec["unrelated_audio_path"])], 2, 3, absolute)
        require(timeline.AddMarker(40, "Blue", "Editorial beat", "Unrelated editor marker", 1, "editor:beat"), "Could not add unrelated marker")
        conflict = timeline.DuplicateTimeline(spec["conflict_timeline_name"]); require(conflict is not None and project.SetCurrentTimeline(conflict), "Could not create conflict timeline")
        append(pool, by_path[os.path.realpath(spec["unknown_audio_path"])], 2, 4, int(conflict.GetStartFrame()))
        stale = timeline.DuplicateTimeline(spec["stale_timeline_name"]); require(stale is not None, "Could not create stale-plan timeline")
        require(project.SetCurrentTimeline(timeline), "Could not restore source timeline")
        require(manager.SaveProject(), "Could not save P8 fixture")
        result.update({"project_unique_id": str(project.GetUniqueId()), "source": snapshot(timeline), "conflict": snapshot(conflict), "stale": snapshot(stale)})
    else:
        project = manager.GetCurrentProject(); require(project is not None and project.GetName() == project_name, "Current project is not the exact P8 fixture")
        if operation == "cleanup":
            manager.CloseProject(project); result["deleted"] = bool(manager.DeleteProject(project_name)); require(result["deleted"], "P8 fixture cleanup failed")
        else:
            timeline = timeline_by_name(project, str(spec["timeline_name"])); require(timeline is not None and project.SetCurrentTimeline(timeline), "Requested P8 fixture timeline not found")
            if operation == "mutate_stale":
                require(timeline.AddMarker(10, "Green", "Stale mutation", "P8 stale-plan proof", 1, "scorecraft:cue:v1:STALE"), "Could not mutate stale-plan timeline")
                require(manager.SaveProject(), "Could not save stale-plan mutation")
            result["snapshot"] = snapshot(timeline)
    with open(sys.argv[2], "x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True); handle.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(f"SCORECRAFT_P8_FIXTURE_ERROR: {error}\n"); sys.exit(1)
