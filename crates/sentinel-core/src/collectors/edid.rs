//! Bounded EDID base/CTA detailed timings. Other descriptors remain explicitly unparsed.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayMode {
    pub width: u32,
    pub height: u32,
    pub hz: f64,
}
pub fn parse_edid_modes(bytes: &[u8]) -> crate::Result<Vec<DisplayMode>> {
    if bytes.len() < 128
        || bytes.len() > 9 * 128
        || bytes.len() % 128 != 0
        || bytes[..8] != [0, 255, 255, 255, 255, 255, 255, 0]
        || bytes[126] as usize + 1 != bytes.len() / 128
        || bytes
            .chunks_exact(128)
            .any(|b| b.iter().fold(0u8, |a, b| a.wrapping_add(*b)) != 0)
    {
        return Err("EDID 长度、扩展或校验和无效。".into());
    }
    let mut modes = vec![];
    let mut dtd = |d: &[u8]| {
        let clock = u16::from_le_bytes([d[0], d[1]]) as u64 * 10000;
        let w = d[2] as u32 + ((d[4] as u32 & 0xf0) << 4);
        let hb = d[3] as u32 + ((d[4] as u32 & 15) << 8);
        let h = d[5] as u32 + ((d[7] as u32 & 0xf0) << 4);
        let vb = d[6] as u32 + ((d[7] as u32 & 15) << 8);
        if clock > 0 && w > 0 && h > 0 && hb > 0 && vb > 0 && d[17] & 0x80 == 0 {
            let hz = clock as f64 / ((w + hb) as f64 * (h + vb) as f64);
            if (1.0..=1000.0).contains(&hz) {
                modes.push(DisplayMode {
                    width: w,
                    height: h,
                    hz,
                });
            }
        }
    };
    for d in bytes[54..126].chunks_exact(18) {
        dtd(d);
    }
    for ext in bytes[128..].chunks_exact(128) {
        if ext[0] == 2 {
            let start = ext[2] as usize;
            if (4..=109).contains(&start) {
                for d in ext[start..127].chunks_exact(18) {
                    dtd(d);
                }
            }
        }
    }
    Ok(modes)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn checksum(b: &mut [u8]) {
        b[127] = 0u8.wrapping_sub(b[..127].iter().fold(0u8, |a, b| a.wrapping_add(*b)));
    }
    fn timing() -> [u8; 18] {
        let mut d = [0; 18];
        d[..2].copy_from_slice(&14850u16.to_le_bytes());
        d[2] = 0x80;
        d[3] = 0x18;
        d[4] = 0x71;
        d[5] = 0x38;
        d[6] = 45;
        d[7] = 0x40;
        d
    }
    fn base() -> Vec<u8> {
        let mut b = vec![0; 128];
        b[..8].copy_from_slice(&[0, 255, 255, 255, 255, 255, 255, 0]);
        b[54..72].copy_from_slice(&timing());
        checksum(&mut b);
        b
    }
    #[test]
    fn decodes_same_resolution_base_and_cta_detailed_timings() {
        let mut b = base();
        let m = parse_edid_modes(&b).unwrap();
        assert_eq!((m[0].width, m[0].height), (1920, 1080));
        assert!((m[0].hz - 60.0).abs() < 0.01);
        b[126] = 1;
        checksum(&mut b);
        let mut ext = vec![0; 128];
        ext[0] = 2;
        ext[2] = 4;
        ext[4..22].copy_from_slice(&timing());
        checksum(&mut ext);
        b.extend(ext);
        assert_eq!(parse_edid_modes(&b).unwrap().len(), 2);
    }
    #[test]
    fn rejects_corrupt_or_incomplete_edid_and_skips_interlaced_descriptors() {
        let mut b = base();
        b[30] ^= 1;
        assert!(parse_edid_modes(&b).is_err());
        let mut b = base();
        b[126] = 1;
        checksum(&mut b);
        assert!(parse_edid_modes(&b).is_err());
        let mut b = base();
        b[71] |= 0x80;
        checksum(&mut b);
        assert!(parse_edid_modes(&b).unwrap().is_empty());
        assert!(parse_edid_modes(&[0; 127]).is_err());
    }
}
