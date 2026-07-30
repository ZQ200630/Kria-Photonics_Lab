use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

const NPY_MAGIC: &[u8; 6] = b"\x93NUMPY";
const NPY_VERSION: [u8; 2] = [1, 0];
const NPY_ALIGNMENT: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NpyLayout {
    pub data_offset: u64,
    pub element_count: u64,
    pub element_bytes: u64,
}

fn shape_tuple(shape: &[usize]) -> Result<String, String> {
    if shape.is_empty() {
        return Ok("()".to_string());
    }
    if shape.contains(&0) {
        return Err("NPY dimensions must be non-zero".to_string());
    }
    if shape.len() == 1 {
        return Ok(format!("({},)", shape[0]));
    }
    Ok(format!(
        "({})",
        shape
            .iter()
            .map(usize::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn npy_header(descriptor: &str, shape: &[usize]) -> Result<Vec<u8>, String> {
    let shape = shape_tuple(shape)?;
    let dictionary =
        format!("{{'descr': '{descriptor}', 'fortran_order': False, 'shape': {shape}, }}");
    let preamble_len = NPY_MAGIC.len() + NPY_VERSION.len() + 2;
    let unpadded_len = preamble_len + dictionary.len() + 1;
    let padded_len = unpadded_len.div_ceil(NPY_ALIGNMENT) * NPY_ALIGNMENT;
    let header_len = padded_len - preamble_len;
    let encoded_header_len = u16::try_from(header_len)
        .map_err(|_| "NPY v1 header exceeds 65535 bytes".to_string())?;

    let mut bytes = Vec::with_capacity(padded_len);
    bytes.extend_from_slice(NPY_MAGIC);
    bytes.extend_from_slice(&NPY_VERSION);
    bytes.extend_from_slice(&encoded_header_len.to_le_bytes());
    bytes.extend_from_slice(dictionary.as_bytes());
    bytes.resize(padded_len - 1, b' ');
    bytes.push(b'\n');
    Ok(bytes)
}

fn checked_element_count(shape: &[usize]) -> Result<u64, String> {
    shape.iter().try_fold(1u64, |count, dimension| {
        count
            .checked_mul(*dimension as u64)
            .ok_or_else(|| "NPY shape overflows element count".to_string())
    })
}

pub fn create_zeroed_f32(path: &Path, shape: &[usize]) -> Result<NpyLayout, String> {
    let header = npy_header("<f4", shape)?;
    let element_count = checked_element_count(shape)?;
    let data_bytes = element_count
        .checked_mul(4)
        .ok_or_else(|| "NPY float32 byte count overflows".to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|err| format!("create {} failed: {err}", path.display()))?;
    file.write_all(&header)
        .map_err(|err| format!("write {} header failed: {err}", path.display()))?;
    file.set_len(header.len() as u64 + data_bytes)
        .map_err(|err| format!("size {} failed: {err}", path.display()))?;
    Ok(NpyLayout {
        data_offset: header.len() as u64,
        element_count,
        element_bytes: 4,
    })
}

pub fn write_f64_vector(path: &Path, values: &[f64]) -> Result<(), String> {
    let header = npy_header("<f8", &[values.len()])?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|err| format!("create {} failed: {err}", path.display()))?;
    file.write_all(&header)
        .map_err(|err| format!("write {} header failed: {err}", path.display()))?;
    for value in values {
        file.write_all(&value.to_le_bytes())
            .map_err(|err| format!("write {} data failed: {err}", path.display()))?;
    }
    file.flush()
        .map_err(|err| format!("flush {} failed: {err}", path.display()))
}

pub fn write_f32_at(
    file: &mut File,
    layout: NpyLayout,
    element_offset: u64,
    values: &[f32],
) -> Result<(), String> {
    let end = element_offset
        .checked_add(values.len() as u64)
        .ok_or_else(|| "NPY write offset overflows".to_string())?;
    if end > layout.element_count {
        return Err(format!(
            "NPY write [{}..{}) exceeds {} elements",
            element_offset, end, layout.element_count
        ));
    }
    let byte_offset = layout
        .data_offset
        .checked_add(
            element_offset
                .checked_mul(layout.element_bytes)
                .ok_or_else(|| "NPY write byte offset overflows".to_string())?,
        )
        .ok_or_else(|| "NPY write byte offset overflows".to_string())?;
    file.seek(SeekFrom::Start(byte_offset))
        .map_err(|err| format!("seek NPY write failed: {err}"))?;
    for value in values {
        file.write_all(&value.to_le_bytes())
            .map_err(|err| format!("write NPY data failed: {err}"))?;
    }
    Ok(())
}

pub fn read_f32_at(
    file: &mut File,
    layout: NpyLayout,
    element_offset: u64,
    element_count: usize,
) -> Result<Vec<f32>, String> {
    let end = element_offset
        .checked_add(element_count as u64)
        .ok_or_else(|| "NPY read offset overflows".to_string())?;
    if end > layout.element_count {
        return Err(format!(
            "NPY read [{}..{}) exceeds {} elements",
            element_offset, end, layout.element_count
        ));
    }
    let byte_offset = layout
        .data_offset
        .checked_add(
            element_offset
                .checked_mul(layout.element_bytes)
                .ok_or_else(|| "NPY read byte offset overflows".to_string())?,
        )
        .ok_or_else(|| "NPY read byte offset overflows".to_string())?;
    file.seek(SeekFrom::Start(byte_offset))
        .map_err(|err| format!("seek NPY read failed: {err}"))?;
    let mut raw = vec![0u8; element_count * 4];
    file.read_exact(&mut raw)
        .map_err(|err| format!("read NPY data failed: {err}"))?;
    Ok(raw
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("{name}_{}_{}.npy", std::process::id(), 1))
    }

    #[test]
    fn writes_numpy_v1_float32_volume_with_c_order_shape() {
        let path = temp_path("pa_orpam_f32");
        let layout = create_zeroed_f32(&path, &[2, 3, 4]).expect("create npy");
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .expect("open npy");
        write_f32_at(&mut file, layout, 4, &[1.25, -2.5, 8.0]).expect("write values");
        let values = read_f32_at(&mut file, layout, 4, 3).expect("read values");
        assert_eq!(values, vec![1.25, -2.5, 8.0]);

        let raw = std::fs::read(&path).expect("read file");
        assert_eq!(&raw[..6], NPY_MAGIC);
        assert_eq!(&raw[6..8], &NPY_VERSION);
        let header_len = u16::from_le_bytes([raw[8], raw[9]]) as usize;
        let header = std::str::from_utf8(&raw[10..10 + header_len]).expect("header utf8");
        assert!(header.contains("'descr': '<f4'"));
        assert!(header.contains("'fortran_order': False"));
        assert!(header.contains("'shape': (2, 3, 4)"));
        assert_eq!(layout.data_offset as usize % NPY_ALIGNMENT, 0);
        assert_eq!(raw.len() as u64, layout.data_offset + 2 * 3 * 4 * 4);
        std::fs::remove_file(path).expect("remove temp");
    }

    #[test]
    fn rejects_out_of_bounds_incremental_access() {
        let path = temp_path("pa_orpam_bounds");
        let layout = create_zeroed_f32(&path, &[2, 2]).expect("create npy");
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .expect("open npy");
        let error = write_f32_at(&mut file, layout, 3, &[1.0, 2.0]).expect_err("bounds");
        assert!(error.contains("exceeds 4 elements"));
        std::fs::remove_file(path).expect("remove temp");
    }
}
