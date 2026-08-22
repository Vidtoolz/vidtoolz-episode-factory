#!/usr/bin/env python3
"""Disposable Resolve controller for approved-master/Resolve-copy compatibility."""
import hashlib
import json
import os
import sys

PREFIX = "VIDTOOLZ_RESOLVE_HARDLINK_GATE_"


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha256_file(filename):
    digest = hashlib.sha256()
    with open(filename, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_of(item):
    return os.path.realpath(str(item.GetClipProperty("File Path") or ""))


def timeline_snapshot(project, timeline):
    clips = timeline.GetItemListInTrack("audio", 1) or []
    result = []
    for clip in clips:
        item = clip.GetMediaPoolItem()
        source = path_of(item)
        result.append({
            "source_path": source,
            "source_sha256": sha256_file(source),
            "duration_frames": int(round(float(clip.GetDuration()))),
            "media_properties": item.GetClipProperty() or {},
        })
    return {
        "project": str(project.GetName()),
        "timeline": str(timeline.GetName()),
        "timecode": str(timeline.GetCurrentTimecode()),
        "clips": result,
    }


def current(manager, project_name):
    project = manager.GetCurrentProject()
    if project is None or project.GetName() != project_name:
        project = manager.LoadProject(project_name)
    require(project is not None and project.GetName() == project_name, "Exact fixture project is not open")
    timeline = project.GetCurrentTimeline()
    require(timeline is not None, "Fixture timeline is unavailable")
    return project, timeline


def main():
    require(len(sys.argv) == 3, "Usage: fixture.py input.json output.json")
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    operation = str(spec.get("operation", ""))
    require(operation in {"setup", "inspect", "rewind", "close_reopen", "cleanup"}, "Unsupported fixture operation")
    project_name = str(spec.get("project_name", ""))
    require(project_name.startswith(PREFIX), "Fixture project lacks the protected prefix")

    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp("Resolve")
    require(resolve is not None, "Resolve scripting unavailable")
    manager = resolve.GetProjectManager()
    require(manager is not None, "Resolve ProjectManager unavailable")
    database = manager.GetCurrentDatabase() or {}
    require(database.get("DbType") == "Disk" and database.get("DbName") == "Local Database", "Fixture is not using the isolated disk library")
    result = {"operation": operation, "project_name": project_name, "resolve_version": resolve.GetVersionString()}

    if operation == "setup":
        require(not (manager.GetProjectListInCurrentFolder() or []), "Isolated Resolve library is not empty")
        source = os.path.realpath(str(spec["resolve_copy"]))
        require(os.path.isfile(source) and not os.path.islink(source), "Resolve source is not a safe regular file")
        project = manager.CreateProject(project_name, str(spec["fixture_root"]))
        require(project is not None, "Could not create fixture project")
        require(project.SetSetting("timelineFrameRate", "24"), "Resolve rejected timeline frame rate")
        pool = project.GetMediaPool()
        imported = resolve.GetMediaStorage().AddItemListToMediaPool([source]) or []
        require(len(imported) == 1 and path_of(imported[0]) == source, "Resolve did not import the exact source path")
        timeline = pool.CreateEmptyTimeline("Hardlink Audio Test")
        require(timeline is not None and project.SetCurrentTimeline(timeline), "Could not create/select fixture timeline")
        if int(timeline.GetTrackCount("audio") or 0) < 1:
            require(timeline.AddTrack("audio"), "Could not add audio track")
        absolute = int(timeline.GetStartFrame())
        appended = pool.AppendToTimeline([{"mediaPoolItem": imported[0], "mediaType": 2, "trackIndex": 1, "recordFrame": absolute}]) or []
        require(len(appended) == 1, "Resolve could not place source audio on the timeline")
        require(resolve.OpenPage("edit"), "Resolve could not open the Edit page")
        require(manager.SaveProject(), "Resolve could not save the fixture")
        result["snapshot"] = timeline_snapshot(project, timeline)
    elif operation == "cleanup":
        project, _ = current(manager, project_name)
        manager.CloseProject(project)
        result["deleted"] = bool(manager.DeleteProject(project_name))
        require(result["deleted"], "Resolve fixture cleanup failed")
    else:
        project, timeline = current(manager, project_name)
        if operation == "close_reopen":
            require(manager.SaveProject(), "Could not save fixture before reopen")
            manager.CloseProject(project)
            project = manager.LoadProject(project_name)
            require(project is not None, "Could not reopen fixture project")
            timeline = project.GetCurrentTimeline()
            require(timeline is not None, "Reopened fixture timeline is unavailable")
        require(resolve.OpenPage("edit"), "Resolve could not open the Edit page")
        if operation == "rewind":
            require(timeline.SetCurrentTimecode(timeline.GetStartTimecode()), "Could not rewind fixture timeline")
        result["snapshot"] = timeline_snapshot(project, timeline)

    with open(sys.argv[2], "x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(f"RESOLVE_HARDLINK_GATE_ERROR: {error}\n")
        sys.exit(1)
