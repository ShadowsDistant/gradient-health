/* The plan code's move numbers (GH.PLAN_CODE_MOVES): a move's number is its place in this list,
 * counted from 0. A plan code (src/plancode.js) holds these numbers, not the ids, and a code made
 * today has to read the same in every later version. So this list is frozen and only ever grows:
 *
 * - A new move's id goes at the END, never in between.
 * - Nothing here is reordered or renamed, and a number is never used again.
 * - A move taken out of the library keeps its place here (its number stays taken; a code that holds
 *   it reads as a plan without that exercise, and says so).
 *
 * test/customplan.mjs holds a hash of the 296 that 1.15 shipped with, and fails when a move in the
 * library has no number. There is room for 1,023.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  GH.PLAN_CODE_MOVES = [
    // 1.15: numbers 0 to 295, the library as it stood (src/data/moves.js, then moves-access.js).
    'curl_towel curl_band curl_hammer curl_std curl_slow curl_half curl_1arm hammer_1arm curl_conc tri_skull tri_oh',
    'tri_band tri_band_oh tri_dip_bent tri_oh_slow tri_dip tri_diamond tri_oh1 push_wall push_incline push_knee',
    'push_std push_slow push_pause push_decline push_archer chest_press chest_press_slow chest_fly chest_press1',
    'chest_press_half sq_bw sq_goblet sq_goblet_pause sq_stepup sq_goblet_lunge sq_split sq_lunge sq_bulgarian',
    'sq_pistol sq_wallsit sq_jump hg_bridge hg_bridge1 hg_deadlift hg_swing hg_rdl hg_sldl hg_sldl_slow hg_swing1',
    'gl_bridge gl_kbbridge gl_thrust gl_thrust_pause gl_bridge1 gl_thrust1 calf_bw calf_wall_slow calf_load calf_1leg',
    'ham_walkout ham_slide ham_band_gm ham_slide1 ham_nordic row_prone_w row_superman row_door row_band_high',
    'row_towel row_table row_band row_db row_chair row_slow row_pause row_half row_chair_half pull_hang pull_scap',
    'pull_neg pull_chin pull_up pull_slow rear_towel rear_band rear_ytw rear_ytw_hold rear_face_band rear_high_pull',
    'rear_fly rear_fly_slow rear_fly_pause back_birddog back_superman back_ext back_ext_pause press_pike_incline',
    'press_band press_db press_pike press_db_slow press_1arm press_pike_decline raise_wall_iso raise_prone_y raise',
    'raise_band raise_slow raise_half raise_pause raise_lean ab_deadbug ab_revcrunch ab_legraise ab_hollow ab_vup',
    'abl_crunch abl_kb abl_kb_slow abl_kb_arms abl_situp rot_russian rot_chop rot_russian_up rot_kneel_chop rot_slam',
    'rot_toss side_knee side_carry side_plank side_march side_star fin_swing fin_swing1 fin_slam fin_toss fin_march',
    'fin_pulse fin_jacks fin_climbers fin_step_jacks fin_squat_thrust fin_burpee wu_halo wu_circles wu_squat',
    'wu_angels wu_legswing wu_scap wu_pullapart mob_catcow mob_wgs mob_hipflexor mob_squat mob_child mob_openbook',
    'mob_9090 mob_hamfloss mob_calf mob_chest mob_ankle walk imp_heel imp_stamp imp_jog bench_bb bench_db',
    'press_machine bench_smith incline_db incline_bb incline_smith fly_cable fly_pec fly_db squat_bb squat_smith',
    'leg_press rdl_bb deadlift_bb rdl_db thrust_bb leg_curl leg_ext lunge_db split_db leg_curl_db calf_smith calf_db',
    'calf_press pulldown row_cable row_bb row_chest face_pull rev_fly_machine ohp_db ohp_bb press_shoulder_machine',
    'raise_cable curl_bb curl_incline curl_cable pushdown_cable oh_ext_cable skull_ez cg_bench dip_bar cable_crunch',
    'hang_knee pallof rower_int bike_int incline_walk ls_march ls_ext ls_ext_hold ls_lift ls_heel ls_press',
    'hp_seat_hinge cu_seat_band cu_seat cu_seat_hammer cu_seat_slow tr_seat_oh tr_seat_oh_slow tr_seat_kick',
    'sh_seat_press bk_squeeze bk_seat_row bk_seat_db_row bk_seat_pulldown fin_seat_march fin_seat_box wu_seat_march',
    'mob_chin mob_wrist mob_ankle_circles mob_seat_ham bal_seat_reach co_seat_brace co_seat_lean sh_seat_arm',
    'sh_seat_hold sh_seat_raise bk_seat_apart cu_self tr_self ch_seat_squeeze ch_seat_band ch_seat_band_slow',
    'co_seat_pallof wu_seat_circles mob_seat_twist mob_seat_chest sq_sts_hands sq_sts sq_sts_slow lg_heel_wall',
    'hp_ext_chair hp_abd_wall hp_side_lift co_wall_plank co_birddog co_pelvic co_prone_lift bal_tandem_wall',
    'bal_tandem bal_one_wall bal_walk bal_step bal_one bal_clock get_halfkneel get_kneel fin_march_easy fin_step',
    'wu_march wu_heel mob_quad curl_self tri_self chest_palm raise_bw press_reach bk_stand_squeeze ab_stand_crunch',
    'side_stand sq_sts_power sq_bw_power sq_goblet_power sq_sts_hands_power sq_stepup_power leg_press_power',
    // New moves go here, each release's in a line of its own, in the order they were added.
  ].join(' ').split(' ');
})(typeof window !== 'undefined' ? window : globalThis);
