proc read_text_file {path} {
  set fp [open $path r]
  set data [read $fp]
  close $fp
  return $data
}

proc write_text_file {path data} {
  set fp [open $path w]
  puts -nonewline $fp $data
  close $fp
}

proc patch_empty_cdc_waivers {proj_root} {
  set ip_dir [file join $proj_root hardware xilinx-k26-som-2023.2 project_1.gen sources_1 bd project_1 ip]
  set xdc_paths [glob -nocomplain -type f -directory $ip_dir -tails */*_clocks.xdc]
  set total_patched 0

  foreach rel_path [lsort $xdc_paths] {
    set xdc_path [file join $ip_dir $rel_path]
    set file_name [file tail $xdc_path]
    set data [read_text_file $xdc_path]

    if {[string first "SKIP_EMPTY_CDC_WAIVER_BEGIN" $data] >= 0} {
      puts "EMPTY_CDC_WAIVER_XDC_ALREADY_PATCHED=$xdc_path"
      continue
    }

    set lines [split $data "\n"]
    set out_lines {}
    set patched_in_file 0
    set waiver_index 0

    for {set i 0} {$i < [llength $lines]} {incr i} {
      set line [lindex $lines $i]
      if {[regexp {^create_waiver -type CDC .*\\$} $line] && $i + 1 < [llength $lines]} {
        set next_line [string trim [lindex $lines [expr {$i + 1}]]]
        if {[regexp {^-to \[(.*)\]$} $next_line -> to_expr]} {
          set skip_patch [expr {[string match {project_1_auto_us_*_clocks.xdc} $file_name] && $waiver_index == 7}]
          incr waiver_index

          if {!$skip_patch} {
            lappend out_lines "# SKIP_EMPTY_CDC_WAIVER_BEGIN"
            lappend out_lines "# $line"
            lappend out_lines "# [lindex $lines [expr {$i + 1}]]"
            lappend out_lines "# SKIP_EMPTY_CDC_WAIVER_END"
            incr i
            incr patched_in_file
            continue
          }
        }
      }

      lappend out_lines $line
    }

    if {$patched_in_file > 0} {
      write_text_file $xdc_path [join $out_lines "\n"]
      incr total_patched $patched_in_file
      puts "PATCHED_EMPTY_CDC_WAIVERS=$xdc_path COUNT=$patched_in_file"
    }
  }

  puts "PATCHED_EMPTY_CDC_WAIVERS_TOTAL=$total_patched"
}

proc validate_no_unsupported_cdc_waiver_patch {proj_root} {
  set ip_dir [file join $proj_root hardware xilinx-k26-som-2023.2 project_1.gen sources_1 bd project_1 ip]
  set xdc_paths [glob -nocomplain -type f -directory $ip_dir -tails */*_clocks.xdc]

  foreach rel_path [lsort $xdc_paths] {
    set xdc_path [file join $ip_dir $rel_path]
    set data [read_text_file $xdc_path]
    if {[regexp -line {^(set __cdc_to|if \{|unset __cdc_to)} $data]} {
      error "Unsupported Tcl command remains in generated XDC after CDC waiver patch: $xdc_path"
    }
  }
}

