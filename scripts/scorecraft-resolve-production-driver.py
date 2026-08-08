#!/usr/bin/env python3
"""Allowlisted production adapter for an operator-open Resolve target.

The driver never lists/navigates project libraries, loads projects, creates or
deletes projects, or edits the source timeline. Apply duplicates the exact
currently open source timeline and mutates only the duplicate's explicit music
track and Scorecraft-owned markers.
"""
import hashlib
import json
import os
import sys
from fractions import Fraction

MARKER_PREFIX = "scorecraft:cue:v1:"
MAX_TRACKS = 64
MAX_CLIPS = 256
MAX_MARKERS = 512
ALLOWED_OPERATIONS = {"add_selected_music", "replace_recognized_scorecraft_music", "upsert_scorecraft_markers"}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256_file(filename):
    require(os.path.isabs(filename), "Resolve source path is not absolute")
    require(not os.path.islink(filename), "Resolve source path is a symbolic link")
    require(os.path.isfile(filename), "Resolve source path is not a regular file")
    digest = hashlib.sha256()
    with open(filename, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def source_path(item):
    pool_item = item.GetMediaPoolItem()
    require(pool_item is not None, "Timeline clip has no media-pool source")
    value = str(pool_item.GetClipProperty("File Path") or "")
    require(value, "Timeline clip source path is unavailable")
    require(os.path.isabs(value), "Resolve timeline source path is not absolute")
    require(not os.path.islink(value), "Resolve timeline source path is a symbolic link")
    return os.path.realpath(value)


def rational_rate(timeline, expected):
    raw = str(timeline.GetSetting("timelineFrameRate") or "")
    require(raw, "Resolve timeline frame rate is unavailable")
    expected_value = int(expected["numerator"]) / int(expected["denominator"])
    require(abs(float(raw) - expected_value) <= 0.001, "Resolve timeline frame rate differs from the Scorecraft contract")
    if int(expected["numerator"]) % int(expected["denominator"]):
        return {"numerator": int(expected["numerator"]), "denominator": int(expected["denominator"])}
    fraction = Fraction(raw).limit_denominator(1001)
    return {"numerator": fraction.numerator, "denominator": fraction.denominator}


def bounded_items(timeline, media_type, index):
    values = timeline.GetItemListInTrack(media_type, index) or []
    require(len(values) <= MAX_CLIPS, f"Resolve {media_type} track {index} exceeds the bounded clip limit")
    return values


def clip_readback(item, absolute_start):
    properties = item.GetProperty() or {}
    speed = float(properties.get("Speed", 100))
    return {
        "source_sha256": sha256_file(source_path(item)),
        "start_frame": int(round(float(item.GetStart()))) - absolute_start,
        "duration_frames": int(round(float(item.GetDuration()))),
        "speed_percent": int(speed) if speed.is_integer() else speed,
    }


def readback(resolve, project, timeline, spec):
    target = spec["target"]
    audio_count = int(timeline.GetTrackCount("audio") or 0)
    require(audio_count <= MAX_TRACKS, "Resolve timeline exceeds the bounded audio-track limit")
    required = {int(target["narration_track_index"]), int(target["music_track_index"])}
    require(all(1 <= index <= audio_count for index in required), "Explicit narration/music track does not exist")
    absolute_start = int(timeline.GetStartFrame())
    tracks = []
    for index in sorted(required):
        tracks.append({
            "media_type": "audio", "index": index,
            "name": str(timeline.GetTrackName("audio", index) or ""),
            "enabled": bool(timeline.GetIsTrackEnabled("audio", index)),
            "locked": bool(timeline.GetIsTrackLocked("audio", index)),
            "clips": [clip_readback(item, absolute_start) for item in bounded_items(timeline, "audio", index)],
        })
    raw_markers = timeline.GetMarkers() or {}
    require(len(raw_markers) <= MAX_MARKERS, "Resolve timeline exceeds the bounded marker limit")
    markers = [{
        "frame": int(round(float(frame))), "name": str(marker.get("name", "")),
        "duration_frames": int(round(float(marker.get("duration", 1)))),
        "custom_data": str(marker.get("customData", "")),
    } for frame, marker in raw_markers.items()]
    return {
        "schema_version": 1, "role": "scorecraft_resolve_production_readback",
        "resolve_integration_identity": spec["resolve_integration_identity"],
        "project": {"name": str(project.GetName()), "unique_id": str(project.GetUniqueId())},
        "timeline": {
            "name": str(timeline.GetName()), "unique_id": str(timeline.GetUniqueId()),
            "frame_rate": rational_rate(timeline, spec["frame_rate"]),
            "timeline_start_timecode": str(timeline.GetStartTimecode()),
            "duration_frames": int(timeline.GetEndFrame()) - absolute_start,
            "tracks": tracks,
            "markers": sorted(markers, key=lambda value: (value["frame"], value["custom_data"])),
        },
    }


def exact_target(project, timeline, target):
    require(str(project.GetName()) == str(target["project_name"]), "Current Resolve project name differs from explicit target")
    require(str(timeline.GetName()) == str(target["timeline_name"]), "Current Resolve timeline name differs from explicit target")
    if target.get("project_unique_id"):
        require(str(project.GetUniqueId()) == str(target["project_unique_id"]), "Current Resolve project ID differs from bound target")
    if target.get("timeline_unique_id"):
        require(str(timeline.GetUniqueId()) == str(target["timeline_unique_id"]), "Current Resolve timeline ID differs from bound target")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def assert_precondition(actual, expected):
    require(expected and expected.get("role") == "scorecraft_resolve_production_precondition", "Apply requires a supported plan precondition")
    expected_timeline = expected["timeline"]
    actual_timeline = actual["timeline"]
    actual_subset = {
        "project_name": actual["project"]["name"], "project_unique_id": actual["project"]["unique_id"],
        "timeline_name": actual_timeline["name"], "timeline_unique_id": actual_timeline["unique_id"],
        "frame_rate": actual_timeline["frame_rate"], "timeline_start_timecode": actual_timeline["timeline_start_timecode"],
        "duration_frames": actual_timeline["duration_frames"],
        "narration_track": next((track for track in actual_timeline["tracks"] if track["index"] == expected["target"]["narration_track_index"]), None),
        "music_track": next((track for track in actual_timeline["tracks"] if track["index"] == expected["target"]["music_track_index"]), None),
        "scorecraft_markers": [marker for marker in actual_timeline["markers"] if marker["custom_data"].startswith(MARKER_PREFIX)],
        "expected_marker_frames": expected_timeline["expected_marker_frames"],
        "markers_at_expected_frames": [marker for marker in actual_timeline["markers"] if marker["frame"] in set(expected_timeline["expected_marker_frames"])],
    }
    require(canonical(actual_subset) == canonical(expected_timeline), "STALE_PLAN: Resolve Scorecraft-relevant timeline state changed after preflight")


def import_selected(resolve, project, spec):
    supplied = str(spec["selected_music_path"])
    require(os.path.isabs(supplied) and not os.path.islink(supplied), "Selected music path is unsafe")
    selected = os.path.realpath(supplied)
    root = os.path.realpath(spec["allowed_scorecraft_root"])
    require(selected.startswith(root + os.sep), "Selected music path escapes the Scorecraft project")
    require(sha256_file(selected) == spec["selected_music_sha256"], "Selected music bytes differ from Scorecraft authority")
    storage = resolve.GetMediaStorage()
    imported = storage.AddItemListToMediaPool([selected]) or []
    require(len(imported) == 1, "Resolve did not import the exact selected music source")
    require(os.path.realpath(str(imported[0].GetClipProperty("File Path") or "")) == selected, "Resolve imported a different music source")
    return imported[0]


def apply_plan(resolve, manager, project, source, spec):
    plan = spec["plan"]
    require(plan.get("role") == "scorecraft_resolve_production_plan" and plan.get("status") == "ready_to_apply", "Only a ready allowlisted production plan can be applied")
    require(all(operation.get("op") in ALLOWED_OPERATIONS for operation in plan.get("operations", [])), "Production plan contains an unsupported Resolve operation")
    before = readback(resolve, project, source, spec)
    assert_precondition(before, plan.get("precondition"))
    destination_name = str(plan["target"]["destination_timeline_name"])
    require(destination_name and destination_name != source.GetName(), "Apply requires a distinct destination timeline")
    count = int(project.GetTimelineCount() or 0)
    require(count <= 128, "Resolve project exceeds bounded timeline lookup")
    require(all(project.GetTimelineByIndex(index).GetName() != destination_name for index in range(1, count + 1)), "Destination timeline already exists")
    duplicate = source.DuplicateTimeline(destination_name)
    require(duplicate is not None and project.SetCurrentTimeline(duplicate), "Resolve could not create/select the non-destructive integration timeline")
    target = plan["target"]
    absolute_start = int(duplicate.GetStartFrame())
    selected_item = None
    for operation in plan["operations"]:
        if operation["op"] in {"add_selected_music", "replace_recognized_scorecraft_music"}:
            if selected_item is None:
                selected_item = import_selected(resolve, project, spec)
            track = int(operation["track_index"])
            if operation["op"] == "replace_recognized_scorecraft_music":
                candidates = [item for item in bounded_items(duplicate, "audio", track) if sha256_file(source_path(item)) == operation["expected_old_sha256"]]
                require(len(candidates) == 1, "Recognized old Scorecraft music is no longer unique")
                require(duplicate.DeleteClips(candidates, False), "Resolve could not remove recognized old Scorecraft music from the duplicate")
            result = project.GetMediaPool().AppendToTimeline([{
                "mediaPoolItem": selected_item, "mediaType": 2, "trackIndex": track,
                "recordFrame": absolute_start + int(operation["start_frame"]),
            }]) or []
            require(len(result) == 1, "Resolve could not place selected Scorecraft music")
        elif operation["op"] == "upsert_scorecraft_markers":
            for frame, marker in list((duplicate.GetMarkers() or {}).items()):
                if str(marker.get("customData", "")).startswith(MARKER_PREFIX):
                    require(duplicate.DeleteMarkerAtFrame(frame), "Resolve could not remove an owned Scorecraft marker")
            for marker in operation["markers"]:
                require(duplicate.AddMarker(int(marker["frame"]), "Green", str(marker["name"]), "Scorecraft production cue", int(marker["duration_frames"]), str(marker["custom_data"])), f"Resolve could not add {marker['custom_data']}")
    after_spec = dict(spec)
    after_spec["target"] = dict(spec["target"], timeline_name=destination_name, timeline_unique_id=str(duplicate.GetUniqueId()))
    after = readback(resolve, project, duplicate, after_spec)
    require(manager.SaveProject(), "Resolve could not save the verified integration timeline")
    return {"before": before, "after": after, "source_timeline_untouched": True}


def main():
    require(len(sys.argv) == 3, "Usage: scorecraft-resolve-production-driver.py input.json output.json")
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    operation = str(spec.get("operation", ""))
    require(operation in {"inspect", "apply"}, "Unsupported production driver operation")
    module_root = "/opt/resolve/Developer/Scripting/Modules"
    if os.path.isdir(module_root) and module_root not in sys.path:
        sys.path.insert(0, module_root)
    os.environ.setdefault("RESOLVE_SCRIPT_API", "/opt/resolve/Developer/Scripting")
    os.environ.setdefault("RESOLVE_SCRIPT_LIB", "/opt/resolve/libs/Fusion/fusionscript.so")
    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp("Resolve")
    require(resolve is not None, "Resolve scripting connection unavailable. Open Resolve and the intended project/timeline, then retry.")
    manager = resolve.GetProjectManager()
    project = manager.GetCurrentProject() if manager else None
    require(project is not None, "No Resolve project is open")
    timeline = project.GetCurrentTimeline()
    require(timeline is not None, "No Resolve timeline is open")
    exact_target(project, timeline, spec["target"])
    result = {
        "schema_version": 1, "role": "scorecraft_resolve_production_driver_result",
        "operation": operation, "product": resolve.GetProductName(), "version": resolve.GetVersionString(),
    }
    if operation == "inspect":
        result["readback"] = readback(resolve, project, timeline, spec)
    else:
        result.update(apply_plan(resolve, manager, project, timeline, spec))
    with open(sys.argv[2], "x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(f"SCORECRAFT_RESOLVE_PRODUCTION_ERROR: {error}\n")
        sys.exit(1)
