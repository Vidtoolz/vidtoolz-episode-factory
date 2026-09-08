import json
import os
import subprocess

out_dir = "/home/vidtoolz/outputs/episode-factory-blender-integration-v1-2026-09-04/renders"
continuity_shots = [
    {
        "shot_id": "shot_01_intake",
        "description": "Pipeline flowing normally",
        "state": "complete",
        "queue_count": 0,
        "blockage": False
    },
    {
        "shot_id": "shot_02_blocked",
        "description": "Review stage becomes blocked",
        "state": "blocked",
        "queue_count": 0,
        "blockage": True
    },
    {
        "shot_id": "shot_03_backlog",
        "description": "Queue accumulates before blocked review",
        "state": "blocked",
        "queue_count": 7,
        "blockage": True
    },
    {
        "shot_id": "shot_04_cleared",
        "description": "Gate clears and backlog flows into production",
        "state": "complete",
        "queue_count": 0,
        "blockage": False
    }
]

continuity_group = "pipeline_evolution_demonstration"

for s in continuity_shots:
    spec = {
        "scene_id": f"continuity_{s['shot_id']}",
        "scene_type": "explainer",
        "aspect_ratio": "9:16",
        "visual_intent": s["description"],
        "continuity_group": continuity_group,
        "layout_mode": "vertical_stack",
        "disposition": "DIRECT_BLENDER",
        "camera": {"mode": "overview", "focal_length_mm": 50.0},
        "primitives": [
            {"primitive": "stage", "id": "intake", "label": "INTAKE", "state": "complete"},
            {"primitive": "stage", "id": "review", "label": "REVIEW_GATE", "state": s["state"]},
            {"primitive": "stage", "id": "deliver", "label": "PRODUCTION", "state": "complete" if s["shot_id"] == "shot_04_cleared" else "inactive"}
        ],
        "relationships": [
            {"type": "flow", "from": "intake", "to": "review", "state": "active"},
            {"type": "flow", "from": "review", "to": "deliver", "state": "active" if s["state"] == "complete" else "blocked"}
        ]
    }
    if s["blockage"]:
        spec["primitives"].append({"primitive": "blockage", "id": "review_block", "attached_to": "review"})
    if s["queue_count"] > 0:
        spec["primitives"].append({"primitive": "queue", "id": "review_queue", "attached_to": "review", "count": s["queue_count"]})

    spec_path = f"/tmp/{spec['scene_id']}.json"
    blend_path = os.path.join(out_dir, f"{spec['scene_id']}.blend")
    png_path = os.path.join(out_dir, f"{spec['scene_id']}.png")
    
    with open(spec_path, "w") as f:
        json.dump(spec, f, indent=2)

    # Compile
    subprocess.run(["blender", "--background", "--python", "/home/vidtoolz/vidtoolz-blender/primitives/v1/builders/scene_compiler.py", "--", spec_path, blend_path], check=True, capture_output=True)
    # Render
    subprocess.run(["blender", "--background", blend_path, "--render-output", png_path, "--render-frame", "1"], check=True, capture_output=True)
    # Move / rename render from 0001
    rendered_f1 = f"{png_path}0001.png"
    if os.path.exists(rendered_f1):
        os.rename(rendered_f1, png_path)

    print(f"Generated Continuity Shot: {spec['scene_id']} -> {png_path} ({os.path.getsize(png_path)} bytes)")

print("CONTINUITY_GROUP_EVOLUTION_COMPLETE")
