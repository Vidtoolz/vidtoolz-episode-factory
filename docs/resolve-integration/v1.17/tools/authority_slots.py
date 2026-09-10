#!/usr/bin/env python3
"""AUTHORITY-SLOT DISCOVERY — tooling, INTERNAL_NON_AUTHORIZING (v1.17, V116-B1).

WHY THIS EXISTS. v1.16 published a HAND-WRITTEN inventory of ten authorizing slots and audited current artifacts with
a scanner whose "is this reference marked as demoted?" test was a substring search for any of ~25 phrases anywhere in
the surrounding sentence. Codex found the eleventh slot: `EVIDENCE-SET-WORKFLOW.json#toctou.law` said

    "... the bundle's binding no longer resolves, and derive_attachment_state refuses."

which designates the DIAGNOSTIC function as the refusing authority. The scanner suppressed it because the sentence
contains the phrase "no longer" - which modifies *the binding*, not the function's authority class - and because
commas were not clause delimiters, so the offending clause was never isolated. An unrelated English phrase produced a
false negative, and the hand-written inventory had no way to notice a slot nobody had listed.

WHAT THIS MODULE DOES. It replaces both mechanisms with derived ones:

  1. FUNCTION REFERENCE NORMALIZATION (mission section 9). Bare, module-qualified, dotted, markdown-code, path- and
     anchor-qualified forms (`authority_lib.py#derive_attachment_state`, `tools/authority_lib.py#...`,
     `authority_lib.derive_attachment_state`, `` `derive_attachment_state` ``) all normalise to one canonical name
     before classification.
  2. CLAUSE-LOCAL, PAREN-AWARE CLAUSE SPLITTING (section 7). Clauses break at '.', ';', ':' AND ',' at parenthesis
     depth zero, plus dashes and newlines, so a claim about one thing cannot silence a claim about another.
  3. PER-REFERENCE ROLE CLASSIFICATION (sections 5, 8). Each occurrence gets a role from ITS OWN clause:
     DIAGNOSTIC_DECLARATION when that clause carries an explicit class token; AUTHORIZING_DESIGNATION when the clause
     attributes deciding / refusing / enforcing / deriving / gating / validating behaviour to the function; otherwise
     MENTION. Negation is therefore local: "X is no longer authoritative; Y is authoritative" classifies X and Y
     separately, and a phrase like "the binding no longer resolves" cannot classify anything at all.
  4. SLOT DISCOVERY (sections 4, 5, 10, 18). Every current machine-readable field and every current normative prose
     line is walked; every AUTHORIZING_DESIGNATION is a slot. No key-name allowlist, no hardcoded exceptions: a slot
     is discovered because of what its VALUE says, so an unfamiliar key cannot hide one.

The two frozen laws this module enforces, both fail-closed:

  R1  Every reference to a demoted (diagnostic or provisional-until-M3) function in a CURRENT artifact must carry an
      explicit class token in its own clause.
  R2  Every clause that designates authority must name a function whose canonical class is `authorizing`.

Nothing here is authority: it decides no attachment state, eligibility or commit. It reads frozen artifacts and the
canonical class map and reports. Both the build (which publishes the discovery law) and the validator (which
regenerates the inventory and audits it) use this one implementation.
"""
import json
import os
import re
import sys

AUTHORITY_CLASS = "INTERNAL_NON_AUTHORIZING"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import authority_lib as L  # noqa: E402

# ---- section 9: the reference forms that must all normalise to one canonical function name
_QUALIFIER = r"(?:(?:tools/)?[A-Za-z_][A-Za-z0-9_]*(?:\.py)?[#.])?"
_TICKS = r"[`'\"]*"


def function_pattern(names):
    """One regex matching every accepted reference form of any of `names`, longest name first so that
    `derive_attachment_state_authorizing` is never matched as `derive_attachment_state` plus a suffix."""
    ordered = sorted(names, key=len, reverse=True)
    return re.compile(r"(?<![\w])" + _TICKS + _QUALIFIER + r"(" + "|".join(map(re.escape, ordered)) + r")(?![\w])")


AUTHORITY_MODULE = "authority_lib"
# A same-named function in another module is a DIFFERENT symbol. evidence_authoring.derive_attachment_state is the
# AUTHORIZING authoring wrapper (it loads through authority_lib.load_governed_evidence_set and calls
# derive_attachment_state_authorizing); it is not the diagnostic core function, and the classified decision set
# names authority_lib symbols. Conflating them would flag a correct statement (section 9).
FOREIGN_MODULES = ("evidence_authoring", "evidence_authoring_testkit", "a2_prepare", "a2_verify", "fixture_evidence")


def normalize_reference(raw):
    """Return (module_or_None, canonical_name).

    `tools/authority_lib.py#derive_attachment_state(...)` -> ('authority_lib', 'derive_attachment_state')
    `evidence_authoring.derive_attachment_state`           -> ('evidence_authoring', 'derive_attachment_state')
    `` `derive_attachment_state` ``                        -> (None, 'derive_attachment_state')"""
    s = raw.strip().strip("`'\"")
    s = s.split("(")[0]
    module = None
    for sep in ("#", "/"):
        if sep in s:
            head, s = s.rsplit(sep, 1)
            head = head.rsplit("/", 1)[-1]
            if head.endswith(".py"):
                module = head[:-3]
            elif head:
                module = module or head
    if "." in s:
        head, s = s.rsplit(".", 1)
        head = head.rsplit(".", 1)[-1]
        if head.endswith(".py"):
            head = head[:-3]
        module = module or head or None
    return module, s.strip()


# ---- section 7: clause boundaries. Commas count, and parentheses/brackets protect their contents so that an
# argument list or a parenthetical aside is never split mid-claim.
_CLAUSE_BREAKS = ".;:,\n"


def clauses(text):
    """Paren-aware clause split. This is the mechanism V116-B1 turned on: with commas as boundaries, the v1.16 TOCTOU
    sentence isolates 'and derive_attachment_state refuses', which carries no class token and is therefore caught.

    Two rules keep the split from cutting a reference in half (section 9): a delimiter breaks only at parenthesis
    depth zero, and only when the NEXT character is whitespace or the end of the text. So the dots in
    `authority_lib.evaluate_eligibility`, `tools/authority_lib.py#derive_attachment_state`, `v1.16` and `1.15.0`, and
    the commas inside an argument list, are all inert - while ordinary prose punctuation still ends a clause."""
    out, buf, depth = [], "", 0
    n = len(text)
    for i, ch in enumerate(text):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        is_break = ch == "\n" or (ch in _CLAUSE_BREAKS and depth == 0
                                  and (i + 1 == n or text[i + 1].isspace()))
        if is_break:
            if buf.strip():
                out.append(buf.strip())
            buf = ""
            continue
        buf += ch
    if buf.strip():
        out.append(buf.strip())
    return out


# ---- sections 5 and 8: the role vocabulary. CLASS_TOKENS declare a function's class; AUTHORITY_TOKENS attribute
# authority behaviour to it. Neither list contains a bare negation like "no longer": negation is handled by clause
# locality, not by phrase presence.
CLASS_TOKENS = ("DIAGNOSTIC", "diagnostic", "NON_AUTHORIZING", "NON-AUTHORIZING", "non-authorizing",
                "non_authorizing", "PROVISIONAL_UNTIL_M3", "provisional-until-M3", "provisional_until_m3",
                "not authority", "never be selected", "NOT authority")
AUTHORITY_TOKENS = ("refuses", "refusal", "refusing", "decides", "deciding", "decision", "authoritative",
                    # noun forms of the same claim: "the AUTHORIZING evaluator is X" designates just as plainly as
                    # "X evaluates", and a negated noun form ("X is no longer the evaluator") denies just as plainly
                    "evaluator", "decider", "refuser",
                    "authorizes", "authorizing", "authorises", "enforce", "enforces", "enforcing", "derives",
                    "derived by", "computed by", "evaluated by", "gates", "gating", "validates", "validated by",
                    "the only", "ONLY", "must use", "entry point", "entrypoint", "authority", "loader")
HISTORY_TOKENS = ("SUPERSEDED", "superseded", "HISTORICAL", "historical", "was then", "then named", "of its era",
                  "reads as its", "in v1.1", "as of v1.1", "v1.12", "v1.13", "v1.14", "v1.15", "v1.16",
                  "V112-", "V113-", "V114-", "V115-", "V116-", "authorizing counterpart", "corrected")

ROLE_DIAGNOSTIC = "DIAGNOSTIC_DECLARATION"
ROLE_AUTHORIZING = "AUTHORIZING_DESIGNATION"
ROLE_HISTORICAL = "HISTORICAL_STATEMENT"
ROLE_MENTION = "MENTION"
ROLES = (ROLE_AUTHORIZING, ROLE_DIAGNOSTIC, ROLE_HISTORICAL, ROLE_MENTION)


# ---- section 7: STRUCTURED classification for machine-readable artifacts. A key path can declare the role of its
# own value, and that is a stronger, non-prose signal than any verb in the text. v1.16 judged JSON by an exemption
# list of key NAMES; this judges by what the key path MEANS, and only as one input among three.
# Matched as substrings of the key path, diagnostic/provisional FIRST (note that "diagnostic_non_authorizing"
# contains "authorizing"). No exact-name list: a key called diagnostic_law, diagnostic_slots or
# provisional_until_m3_non_authorizing all declare the same thing, and an unfamiliar key simply declares nothing and
# falls through to the clause rules.
_KEYPATH_DIAGNOSTIC = ("diagnostic", "provisional")
_KEYPATH_AUTHORIZING = ("authorizing", "authority_function", "governed_evidence_set_loader")


def _ver(v):
    """Numeric version tuple. String comparison is wrong here: '1.3.0' > '1.17.0' lexicographically, which would
    treat every single-digit-minor statement as current."""
    try:
        return tuple(int(x) for x in str(v).split("."))
    except (TypeError, ValueError):
        return (0,)


def _is_earlier_era(v):
    return _ver(v) < _ver(L.AUTHORITY_VERSION)


def _supersession_versions(bundle_dir):
    """id -> effective_version for every superseded statement, read from the machine form."""
    prec = L.strict_load(os.path.join(bundle_dir, "AUTHORITY-PRECEDENCE.json"))
    return {st["id"]: st.get("effective_version", "0") for st in prec.get("superseded_statements", [])}


_S_ROW = re.compile(r"^\s*\|\s*(S\d+)\s*\|")


def markdown_row_role(artifact, line, versions):
    """AUTHORITY-PRECEDENCE.md renders the supersession tables as `| Sn | old | new | why |` rows. Such a row IS a
    superseded-statement record - the id in its own first column says so - and a row of an earlier era accurately
    records what the authority was then. A row of the CURRENT authority version gets no pass: if it named a demoted
    function as the new authority that would be a live defect (mission sections 17 and 19)."""
    if artifact != "AUTHORITY-PRECEDENCE.md":
        return None
    m = _S_ROW.match(line)
    if not m:
        return None
    return ROLE_HISTORICAL if _is_earlier_era(versions.get(m.group(1), "0")) else None


def keypath_role(artifact, keypath, prec_statements=None):
    """The role a JSON key path declares for its own value, or None.

    AUTHORITY-PRECEDENCE.json#superseded_statements[*] is historical BY STRUCTURE: each entry carries
    status SUPERSEDED and an effective_version, and a statement of an earlier era accurately records what the
    authority was then (mission section 17). A statement of the CURRENT authority version gets no such pass."""
    kp = keypath.lower()
    if artifact == "AUTHORITY-PRECEDENCE.json" and kp.startswith("superseded_statements"):
        m = re.match(r"superseded_statements\.\[(\d+)\]", keypath)
        if m and prec_statements is not None:
            idx = int(m.group(1))
            if idx < len(prec_statements) and not _is_earlier_era(prec_statements[idx].get("effective_version", "0")):
                return None                      # a CURRENT-era supersession is held to the current law
        return ROLE_HISTORICAL
    if any(t in kp for t in _KEYPATH_DIAGNOSTIC):
        return ROLE_DIAGNOSTIC
    if any(t in kp for t in _KEYPATH_AUTHORIZING):
        return ROLE_AUTHORIZING
    return None


# ---- section 8: NEGATION, scoped. A cue only negates a claim when it stands next to an authority word IN THE SAME
# CLAUSE: "X is no longer authoritative" is a non-authorizing claim about X, while "the bundle's binding no longer
# resolves" negates nothing at all, because "resolves" is not an authority word. That distinction is the whole of
# V116-B1: v1.16 treated the mere presence of the phrase as a demotion marker for the entire sentence.
NEGATION_CUES = ("no longer", "not ", "never", "cannot", "ceased to be", "ceases to be", "is no ", "was no ")


def _negated_authority(clause):
    """True when a negation cue precedes an authority word within this clause, i.e. the clause DENIES authority."""
    low = clause.lower()
    for cue in NEGATION_CUES:
        at = low.find(cue)
        while at != -1:
            tail = low[at + len(cue):]
            if any(re.search(r"(?<![\w])" + re.escape(t.lower()) + r"(?![\w])", tail) for t in AUTHORITY_TOKENS):
                return True
            at = low.find(cue, at + 1)
    return False


def classify_clause(clause):
    """The role a clause assigns to the function(s) it names. Order is frozen: an explicit class token wins over
    everything (so 'the diagnostic X refuses' is a declaration, not a designation); then a NEGATED authority claim,
    which is itself a non-authorizing declaration; then a historical marker (so a correction record may quote what an
    older version said); then the clause's authority words; otherwise a bare mention."""
    if any(t in clause for t in CLASS_TOKENS):
        return ROLE_DIAGNOSTIC
    if _negated_authority(clause):
        return ROLE_DIAGNOSTIC
    if any(t in clause for t in HISTORY_TOKENS):
        return ROLE_HISTORICAL
    if any(re.search(r"(?<![\w])" + re.escape(t) + r"(?![\w])", clause) for t in AUTHORITY_TOKENS):
        return ROLE_AUTHORIZING
    return ROLE_MENTION


# ---- sections 16 and 17: the artifact set is DERIVED from precedence status and document role, never from a
# filename pattern. v1.16 excluded changelogs, matrices and the report by regex on their names.
CURRENT_ROLES = ("NORMATIVE_AUTHORITY", "CORRECTION_RECORD")


def artifact_scope(bundle_dir):
    """(scanned, skipped) - every top-level artifact with its precedence status and published role."""
    prec = L.strict_load(os.path.join(bundle_dir, "AUTHORITY-PRECEDENCE.json"))
    roles = {e["path"]: (e["status"], e.get("role", "NORMATIVE_AUTHORITY")) for e in prec["documents"]}
    scanned, skipped = [], []
    for name in sorted(os.listdir(bundle_dir)):
        if not (name.endswith(".json") or name.endswith(".md")):
            continue
        status, role = roles.get(name, ("STILL_ACTIVE", "NORMATIVE_AUTHORITY"))
        (scanned if status == "STILL_ACTIVE" and role in CURRENT_ROLES else skipped).append(
            {"artifact": name, "status": status, "role": role})
    return scanned, skipped


_BLOCK_START = re.compile(r"^\s*(?:\||[-*+]\s|#{1,6}\s|>|\d+\.\s|```)")


def logical_lines(text):
    """Markdown as LOGICAL lines: a wrapped prose sentence is rejoined before clause splitting, so where a line
    happens to wrap cannot change how a statement classifies. Table rows, list items, headings and fences stay
    separate units. Clause locality is unaffected - clauses are still split inside each unit (v1.17, V116-B1)."""
    units, buf, start = [], "", None
    for i, line in enumerate(text.split("\n")):
        if not line.strip():
            if buf:
                units.append((f"line {start}", buf.strip()))
            buf, start = "", None
            continue
        if _BLOCK_START.match(line):
            if buf:
                units.append((f"line {start}", buf.strip()))
            units.append((f"line {i + 1}", line.strip()))
            buf, start = "", None
            continue
        if buf:
            buf += " " + line.strip()
        else:
            buf, start = line.strip(), i + 1
    if buf:
        units.append((f"line {start}", buf.strip()))
    return units


def _walk_json(node, keypath, out):
    if isinstance(node, dict):
        for k, v in node.items():
            _walk_json(v, keypath + (str(k),), out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _walk_json(v, keypath + (f"[{i}]",), out)
    elif isinstance(node, str):
        out.append((".".join(keypath), node))


def references(bundle_dir, names=None):
    """Every reference to a classified decision function in every CURRENT artifact, with its clause and role.

    Rows: artifact, location (JSON key path or 'line N'), reference (as written), function (canonical), clause,
    role, function_class, status."""
    names = tuple(names or L.CLASSIFIED_DECISION_FUNCTIONS)
    pat = function_pattern(names)
    classes = L.authority_function_classes()
    scanned, _ = artifact_scope(bundle_dir)
    versions = _supersession_versions(bundle_dir)
    _prec_sts = L.strict_load(os.path.join(bundle_dir, "AUTHORITY-PRECEDENCE.json")).get("superseded_statements", [])
    rows = []
    for entry in scanned:
        path = os.path.join(bundle_dir, entry["artifact"])
        if entry["artifact"].endswith(".json"):
            values = []
            _walk_json(L.strict_load(path), (), values)
            units = [(kp, text) for kp, text in values]
        else:
            units = logical_lines(open(path, encoding="utf-8").read())
        for location, text in units:
            kp_role = (keypath_role(entry["artifact"], location, _prec_sts) if entry["artifact"].endswith(".json")
                       else markdown_row_role(entry["artifact"], text, versions))
            for clause in clauses(text):
                clause_role = classify_clause(clause)
                # PRECEDENCE OF SIGNALS, frozen: an explicit class or history token in the reference's OWN clause is
                # strongest; then the structured key path; then the clause's authority verbs. So a key called
                # `authorizing_...` cannot launder a demoted name that its own clause marks demoted, and a bare name
                # in a list whose key declares the class is not a violation.
                if clause_role in (ROLE_DIAGNOSTIC, ROLE_HISTORICAL):
                    role = clause_role
                elif kp_role is not None:
                    role = kp_role
                else:
                    role = clause_role
                for m in pat.finditer(clause):
                    module, fn = normalize_reference(m.group(0))
                    if fn not in names:
                        continue
                    if module in FOREIGN_MODULES:
                        # a different symbol in a non-authority module: recorded, never judged against the
                        # authority_lib class map (section 9)
                        rows.append({"artifact": entry["artifact"], "location": location,
                                     "reference": m.group(0).strip(), "function": f"{module}.{fn}", "clause": clause,
                                     "role": ROLE_MENTION, "clause_role": clause_role, "keypath_role": kp_role,
                                     "function_class": "FOREIGN_MODULE_SYMBOL", "status": entry["status"],
                                     "document_role": entry["role"]})
                        continue
                    rows.append({"artifact": entry["artifact"], "location": location, "reference": m.group(0).strip(),
                                 "function": fn, "clause": clause, "role": role, "clause_role": clause_role,
                                 "keypath_role": kp_role, "function_class": classes.get(fn, "UNCLASSIFIED"),
                                 "status": entry["status"], "document_role": entry["role"]})
    return rows


def violations(rows):
    """The two frozen laws, both fail-closed.

    R1 UNMARKED_DEMOTED_REFERENCE - a demoted function referenced in a current artifact whose own clause carries no
       class token and no historical marker. This is exactly V116-B1.
    R2 DEMOTED_FUNCTION_DESIGNATED_AUTHORITATIVE - a clause that designates authority while naming a function whose
       canonical class is not `authorizing`."""
    out = []
    for r in rows:
        if r["function_class"] == "FOREIGN_MODULE_SYMBOL":
            continue
        demoted = r["function_class"] != "authorizing"
        if r["role"] == ROLE_AUTHORIZING and demoted:
            out.append(dict(r, violation="DEMOTED_FUNCTION_DESIGNATED_AUTHORITATIVE"))
        elif demoted and r["role"] not in (ROLE_DIAGNOSTIC, ROLE_HISTORICAL):
            out.append(dict(r, violation="UNMARKED_DEMOTED_REFERENCE"))
    return out


def slots(rows):
    """Every discovered AUTHORIZING slot: one row per (artifact, location) that designates authority, with the
    functions it names. Sections 4/10/18: the inventory is derived, so an unenumerated slot cannot exist."""
    grouped = {}
    for r in rows:
        if r["role"] != ROLE_AUTHORIZING:
            continue
        key = (r["artifact"], r["location"])
        g = grouped.setdefault(key, {"artifact": r["artifact"], "location": r["location"],
                                     "slot": f'{r["artifact"]}#{r["location"]}', "functions": [], "classes": [],
                                     "document_role": r["document_role"], "status": r["status"]})
        if r["function"] not in g["functions"]:
            g["functions"].append(r["function"])
            g["classes"].append(r["function_class"])
    return [grouped[k] for k in sorted(grouped)]


def declared_slots(rows, role):
    """Slots whose clauses declare a class (the diagnostic/provisional inventories)."""
    grouped = {}
    for r in rows:
        if r["role"] != role:
            continue
        key = (r["artifact"], r["location"])
        g = grouped.setdefault(key, {"slot": f'{r["artifact"]}#{r["location"]}', "functions": [], "classes": []})
        if r["function"] not in g["functions"]:
            g["functions"].append(r["function"])
            g["classes"].append(r["function_class"])
    return [grouped[k] for k in sorted(grouped)]


def inventory(bundle_dir):
    """The generated machine-readable inventory (section 18): artifact, key path, referenced function, authority
    role, function class, current/historical status - for every reference in every current artifact."""
    rows = references(bundle_dir)
    scanned, skipped = artifact_scope(bundle_dir)
    return {
        "schema": "vidtoolz.resolveAuthoritySlotInventory.v1",
        "authority_version": L.AUTHORITY_VERSION,
        "law": "GENERATED by tools/validate_v1_17.py through tools/authority_slots.py from the CURRENT artifacts "
               "themselves; never hand-maintained. A slot is authorizing because of what its value SAYS, not because "
               "of its key name, so an unfamiliar key cannot hide one (v1.17, V116-B1).",
        "generator": "tools/authority_slots.py#inventory",
        "classified_functions": list(L.CLASSIFIED_DECISION_FUNCTIONS),
        "roles": list(ROLES),
        "class_tokens": list(CLASS_TOKENS),
        "authority_tokens": list(AUTHORITY_TOKENS),
        "negation_cues": list(NEGATION_CUES),
        "history_tokens": list(HISTORY_TOKENS),
        "clause_law": "clauses break at '.', ';', ':', ',' and newline at parenthesis depth zero; a class or "
                      "authority claim is read ONLY from the clause containing the reference, so an unrelated "
                      "negation elsewhere in the sentence cannot suppress it (the exact V116-B1 mechanism)",
        "reference_forms": ["bare", "module-qualified (authority_lib.derive_attachment_state)",
                            "anchor (authority_lib.py#derive_attachment_state)",
                            "path-qualified (tools/authority_lib.py#derive_attachment_state)",
                            "markdown code (`derive_attachment_state`)", "call form (name(args))"],
        "laws": {"R1": "every reference to a demoted function in a current artifact carries an explicit class token "
                       "in its own clause",
                 "R2": "every clause that designates authority names a function of class `authorizing`"},
        "scanned_artifacts": scanned,
        "not_scanned": skipped,
        "authorizing_slots": slots(rows),
        "diagnostic_slots": declared_slots(rows, ROLE_DIAGNOSTIC),
        "historical_statements": declared_slots(rows, ROLE_HISTORICAL),
        "mentions": declared_slots(rows, ROLE_MENTION),
        "references": rows,
        "violations": violations(rows),
        "counts": {},
    }


def build_inventory(bundle_dir):
    inv = inventory(bundle_dir)
    inv["counts"] = {"scanned_artifacts": len(inv["scanned_artifacts"]), "not_scanned": len(inv["not_scanned"]),
                     "references": len(inv["references"]), "authorizing_slots": len(inv["authorizing_slots"]),
                     "diagnostic_slots": len(inv["diagnostic_slots"]),
                     "historical_statements": len(inv["historical_statements"]),
                     "mentions": len(inv["mentions"]), "violations": len(inv["violations"])}
    return inv


if __name__ == "__main__":
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    inv = build_inventory(here)
    print(json.dumps(inv["counts"], indent=2))
    for v in inv["violations"]:
        print(f'  VIOLATION {v["violation"]}: {v["artifact"]}#{v["location"]} -> {v["function"]} '
              f'({v["function_class"]}) in clause: {v["clause"][:100]!r}')
