use std::ffi::OsStr;
use std::mem::{size_of, zeroed};
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;

/// From <sys/proc_info.h>; libc does not export it.
const PROC_PGRP_ONLY: u32 = 2;

/// Foreground process group of the terminal `pid` is attached to.
pub fn foreground_pgid(pid: u32) -> Option<u32> {
    let tpgid = bsd_info(pid)?.e_tpgid;
    (tpgid > 0).then_some(tpgid)
}

pub fn cwd(pid: u32) -> Option<PathBuf> {
    let info: libc::proc_vnodepathinfo = pid_info(pid, libc::PROC_PIDVNODEPATHINFO)?;
    let path = c_string(info.pvi_cdir.vip_path.as_flattened());
    (!path.is_empty()).then(|| PathBuf::from(OsStr::from_bytes(path)))
}

pub(super) fn group_members(pgid: u32) -> Vec<u32> {
    let mut capacity = 64;
    loop {
        let mut pids = vec![0 as libc::pid_t; capacity];
        let size = (capacity * size_of::<libc::pid_t>()) as libc::c_int;
        let written =
            unsafe { libc::proc_listpids(PROC_PGRP_ONLY, pgid, pids.as_mut_ptr().cast(), size) };
        if written <= 0 {
            return Vec::new();
        }
        // A full buffer may have been truncated.
        if written < size || capacity >= 1 << 16 {
            pids.truncate(written as usize / size_of::<libc::pid_t>());
            return pids
                .into_iter()
                .filter(|p| *p > 0)
                .map(|p| p as u32)
                .collect();
        }
        capacity *= 2;
    }
}

/// The kernel's name for `pid` and its command line.
pub(super) fn name_and_argv(pid: u32) -> Option<(String, Vec<String>)> {
    let info = bsd_info(pid)?;
    let comm = String::from_utf8_lossy(c_string(&info.pbi_comm)).into_owned();
    let argv = procargs(pid)
        .map(|b| parse_procargs(&b))
        .unwrap_or_default();
    Some((comm, argv))
}

/// The bytes of a fixed-size C string field, up to its first NUL.
fn c_string(field: &[libc::c_char]) -> &[u8] {
    let bytes: &[u8] = unsafe { std::slice::from_raw_parts(field.as_ptr().cast(), field.len()) };
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    &bytes[..end]
}

fn bsd_info(pid: u32) -> Option<libc::proc_bsdinfo> {
    pid_info(pid, libc::PROC_PIDTBSDINFO)
}

fn pid_info<T>(pid: u32, flavor: libc::c_int) -> Option<T> {
    let mut info: T = unsafe { zeroed() };
    let size = size_of::<T>() as libc::c_int;
    let read =
        unsafe { libc::proc_pidinfo(pid as libc::c_int, flavor, 0, (&raw mut info).cast(), size) };
    (read == size).then_some(info)
}

/// `sysctl(KERN_PROCARGS2)`, the macOS counterpart of /proc/<pid>/cmdline.
fn procargs(pid: u32) -> Option<Vec<u8>> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as libc::c_int];
    let mut size: libc::size_t = 0;
    let sized = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if sized != 0 || size == 0 {
        return None;
    }
    let mut buf = vec![0u8; size];
    let read = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            buf.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if read != 0 {
        return None;
    }
    buf.truncate(size);
    Some(buf)
}

/// The buffer holds argc, the executable path padded with NULs, then argv
/// and the environment as NUL-terminated strings.
fn parse_procargs(buf: &[u8]) -> Vec<String> {
    let Some((argc, rest)) = buf.split_first_chunk::<4>() else {
        return Vec::new();
    };
    let argc = i32::from_ne_bytes(*argc).max(0) as usize;
    let Some(exec_end) = rest.iter().position(|b| *b == 0) else {
        return Vec::new();
    };
    let Some(start) = rest[exec_end..].iter().position(|b| *b != 0) else {
        return Vec::new();
    };
    rest[exec_end + start..]
        .split(|b| *b == 0)
        .take(argc)
        .map(|a| String::from_utf8_lossy(a).into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn procargs_stop_before_the_environment() {
        let mut buf = 2i32.to_ne_bytes().to_vec();
        buf.extend_from_slice(b"/usr/bin/node\0\0\0node\0cli.js\0HOME=/Users/u\0");
        assert_eq!(parse_procargs(&buf), ["node", "cli.js"]);
    }
}
