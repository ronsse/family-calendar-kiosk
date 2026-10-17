#!/usr/bin/env python3
"""Phase 0 contract verifier — proves db/schema.sql enforces what it promises.

Runs against stdlib sqlite3 so it needs no npm install. Unit A (persistence) ports
these assertions into the Node test suite; until then this is the gate.
    python3 db/verify-schema.py
"""
import pathlib, sqlite3, sys

FAILURES = []

def check(label, fn, want_fail=True):
    try:
        fn(); ok = not want_fail
    except Exception:
        ok = want_fail
    print(("PASS " if ok else "FAIL ") + label)
    if not ok: FAILURES.append(label)

def main():
    con = sqlite3.connect(":memory:")
    con.executescript(pathlib.Path("db/schema.sql").read_text())
    con.execute("PRAGMA foreign_keys=ON")
    c = con.cursor()

    check("STRICT rejects text in an INTEGER column", lambda: c.execute(
        "INSERT INTO child(id,display_name,reading_band,avatar_asset_id,sort_order)"
        " VALUES ('x','X','fluent','a','not-a-number')"))

    c.execute("INSERT INTO asset VALUES ('a-fb','icon','_default','icons/fallback.svg','2026-08-24T00:00:00Z')")
    c.execute("INSERT INTO asset_fallback VALUES ('_default','a-fb')")
    c.execute("INSERT INTO child VALUES ('c1','A','fluent',1,'a-fb',1,1)")
    c.execute("INSERT INTO child VALUES ('c3','C','picture',0,'a-fb',3,1)")
    c.execute("INSERT INTO routine VALUES ('r1','Morning','Morning routine','a-fb','06:00','08:00','MO,TU,WE,TH,FR',1,1)")

    check("reading_band rejects an unknown band", lambda: c.execute(
        "INSERT INTO child VALUES ('cx','X','genius',1,'a-fb',9,1)"))

    def materialize():
        c.execute("INSERT INTO routine_run(routine_id,local_date,opens_at_local,closes_at_local,created_at_utc)"
                  " VALUES ('r1','2026-08-24','06:00','08:00','2026-08-24T12:00:00Z') ON CONFLICT DO NOTHING")
        return c.execute("SELECT id FROM routine_run WHERE routine_id='r1' AND local_date='2026-08-24'").fetchone()[0]
    ids = {materialize() for _ in range(25)}
    print(("PASS " if len(ids) == 1 else "FAIL ") + "25x lazy materialize yields ONE canonical run")
    if len(ids) != 1: FAILURES.append("materialize idempotency")

    run = ids.pop()
    c.execute("INSERT INTO routine_run_step(run_id,child_id,source_step_id,position,label_short,label_full,icon_asset_id)"
              f" VALUES ({run},'c3',NULL,1,'Teeth','Brush your teeth','a-fb')")
    step = c.execute("SELECT id FROM routine_run_step").fetchone()[0]
    c.execute(f"INSERT INTO routine_step_completion(run_step_id,completed_at_utc) VALUES ({step},'2026-08-24T12:05:00Z')")
    check("a second LIVE completion on one step is rejected", lambda: c.execute(
        f"INSERT INTO routine_step_completion(run_step_id,completed_at_utc) VALUES ({step},'2026-08-24T12:06:00Z')"))
    c.execute(f"UPDATE routine_step_completion SET revoked_at_utc='2026-08-24T12:07:00Z' WHERE run_step_id={step}")
    check("after a revoke the child may re-complete the step", lambda: c.execute(
        f"INSERT INTO routine_step_completion(run_step_id,completed_at_utc) VALUES ({step},'2026-08-24T12:08:00Z')"),
        want_fail=False)

    c.execute("INSERT INTO chore(id, label_short, label_full, icon_asset_id, category, "
              "assignment_model, base_points, rrule, active) "
              "VALUES ('ch1','Table','Set the table','a-fb','kitchen','individual',5,'FREQ=DAILY',1)")
    c.execute("INSERT INTO chore_day(chore_id,local_date,points_each,model,created_at_utc)"
              " VALUES ('ch1','2026-08-24',5,'individual','2026-08-24T12:00:00Z')")
    cd = c.execute("SELECT id FROM chore_day").fetchone()[0]
    c.execute(f"INSERT INTO chore_assignment(chore_day_id,child_id,state) VALUES ({cd},'c1','claimed')")
    ca = c.execute("SELECT id FROM chore_assignment").fetchone()[0]
    c.execute("INSERT INTO ledger_entry(child_id,delta,reason,ref_type,ref_id,created_at_utc)"
              f" VALUES ('c1',5,'chore_approved','chore_assignment','{ca}','2026-08-24T12:10:00Z')")
    check("a duplicate ledger entry for one approval is rejected", lambda: c.execute(
        "INSERT INTO ledger_entry(child_id,delta,reason,ref_type,ref_id,created_at_utc)"
        f" VALUES ('c1',5,'chore_approved','chore_assignment','{ca}','2026-08-24T12:10:01Z')"))

    c.execute("INSERT INTO redemption_request(child_id,points_requested,cents_per_point,cash_cents,requested_at_utc)"
              " VALUES ('c1',5,10,50,'2026-08-24T12:11:00Z')")
    check("a second pending redemption per child is rejected", lambda: c.execute(
        "INSERT INTO redemption_request(child_id,points_requested,cents_per_point,cash_cents,requested_at_utc)"
        " VALUES ('c1',3,10,30,'2026-08-24T12:12:00Z')"))

    c.execute("INSERT INTO calendar_source(id,label,external_ref,colour_token) VALUES ('s1','Src','opaque-1','blue')")
    c.execute("INSERT INTO sync_run(source_id,state,started_at_utc) VALUES ('s1','running','2026-08-24T04:00:00Z')")
    sr = c.execute("SELECT id FROM sync_run").fetchone()[0]
    check("an event with BOTH an instant and an all-day date is rejected", lambda: c.execute(
        "INSERT INTO calendar_event(sync_run_id,source_id,external_uid,title,starts_at_utc,all_day_start_date,icon_asset_id)"
        f" VALUES ({sr},'s1','u1','X','2026-08-24T06:00:00Z','2026-08-24','a-fb')"))
    check("an all-day event with only floating dates is accepted", lambda: c.execute(
        "INSERT INTO calendar_event(sync_run_id,source_id,external_uid,title,all_day_start_date,all_day_end_date,icon_asset_id)"
        f" VALUES ({sr},'s1','u2','X','2026-08-24','2026-08-25','a-fb')"), want_fail=False)

    # --- H1 adversarial review regressions -------------------------------
    # Each of these was ACCEPTED by an earlier draft and confirmed empirically before
    # being fixed. They stay here so the hole cannot silently reopen.
    c.execute("INSERT INTO calendar_source(id,label,external_ref,colour_token) VALUES ('s2','Other','opaque-2','red')")
    c.execute("INSERT INTO sync_run(source_id,state,started_at_utc) VALUES ('s2','promoted','2026-08-24T04:00:00Z')")
    other = c.execute("SELECT id FROM sync_run WHERE source_id='s2'").fetchone()[0]

    check("H1: timed event with a NULL end is rejected", lambda: c.execute(
        "INSERT INTO calendar_event(sync_run_id,source_id,external_uid,title,starts_at_utc,icon_asset_id)"
        f" VALUES ({sr},'s1','h1a','X','2026-09-01T14:00:00Z','a-fb')"))
    check("H1: reversed interval is rejected", lambda: c.execute(
        "INSERT INTO calendar_event(sync_run_id,source_id,external_uid,title,starts_at_utc,ends_at_utc,icon_asset_id)"
        f" VALUES ({sr},'s1','h1b','X','2026-09-01T14:00:00Z','2026-09-01T09:00:00Z','a-fb')"))
    check("H1: duplicate external_uid within one generation is rejected", lambda: c.execute(
        "INSERT INTO calendar_event(sync_run_id,source_id,external_uid,title,all_day_start_date,all_day_end_date,icon_asset_id)"
        f" VALUES ({sr},'s1','u2','X','2026-08-24','2026-08-25','a-fb')"))
    check("H1: promoting another source's generation is rejected", lambda: c.execute(
        f"UPDATE calendar_source SET current_sync_run_id={other} WHERE id='s1'"))
    check("H1: promoting a non-promoted generation is rejected", lambda: c.execute(
        f"UPDATE calendar_source SET current_sync_run_id={sr} WHERE id='s1'"))
    check("H1: promoting one's own promoted generation is allowed", lambda: c.execute(
        f"UPDATE calendar_source SET current_sync_run_id={other} WHERE id='s2'"), want_fail=False)

    c.execute("INSERT INTO routine VALUES ('r2','Bed','Bedtime','a-fb','19:00','20:00','SU,MO',2,1)")
    c.execute("INSERT INTO routine_step VALUES ('s-pj','r2','PJs','Pyjamas','a-fb','dressing',1)")
    check("H1: a step from another routine cannot be assigned", lambda: c.execute(
        "INSERT INTO routine_step_assignment VALUES ('r1','c1','s-pj',1)"))

    check("H1: chore state 'rejected' is not representable", lambda: c.execute(
        f"INSERT INTO chore_assignment(chore_day_id,child_id,state) VALUES ({cd},'c3','rejected')"))

    c.execute("INSERT INTO asset VALUES ('a-bad','icon','x','icons/bad.svg',NULL)")
    check("H1: a fallback pointing at an unvalidated asset is rejected", lambda: c.execute(
        "INSERT INTO asset_fallback VALUES ('x','a-bad')"))
    check("H1: the _default fallback cannot be deleted", lambda: c.execute(
        "DELETE FROM asset_fallback WHERE category='_default'"))
    check("H1: an asset a fallback depends on cannot be un-validated", lambda: c.execute(
        "UPDATE asset SET validated_at_utc=NULL WHERE id='a-fb'"))

    # PRAGMA foreign_keys is per-connection; if it is off every FK above is decorative.
    fk_on = c.execute("PRAGMA foreign_keys").fetchone()[0]
    print(("PASS " if fk_on else "FAIL ") + "H1: foreign_keys pragma is ON for this connection")
    if not fk_on: FAILURES.append("foreign_keys off")

    bal = c.execute("SELECT COALESCE(SUM(delta),0) FROM ledger_entry WHERE child_id='c1'").fetchone()[0]
    print(("PASS " if bal == 5 else "FAIL ") + "balance derives from SUM(delta)")
    if bal != 5: FAILURES.append("derived balance")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S): " + "; ".join(FAILURES)); return 1
    print("all contract guarantees hold"); return 0

if __name__ == "__main__":
    sys.exit(main())
