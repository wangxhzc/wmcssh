const READY: &[u8] = b"\x1b]777;wmcssh-ready\x07";
const PASTE_END: &[u8] = b"\x1b[?2004l";
const PATTERNS: [&[u8]; 3] = [b"\x1b[?2004l\r\r\n", b"\x1b[?2004l\r\n", READY];
const MAX_STARTUP_BYTES: usize = 256 * 1024;

#[derive(Default)]
pub(super) struct ShellStartupOutput {
    pending: Vec<u8>,
    processed: usize,
    finished: bool,
}

impl ShellStartupOutput {
    pub fn is_finished(&self) -> bool {
        self.finished
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<u8> {
        if self.finished {
            return bytes.to_vec();
        }
        let mut output = Vec::with_capacity(bytes.len());
        for &byte in bytes {
            if self.finished {
                output.push(byte);
                continue;
            }
            self.processed += 1;
            self.pending.push(byte);
            loop {
                if self.pending == READY {
                    self.pending.clear();
                    self.finished = true;
                    break;
                }
                if PATTERNS[..2].contains(&self.pending.as_slice()) {
                    // Readline inserts this line break before running hidden
                    // input with bracketed paste enabled. Keep the mode change.
                    output.extend_from_slice(PASTE_END);
                    self.pending.clear();
                    break;
                }
                if PATTERNS
                    .iter()
                    .any(|pattern| pattern.starts_with(&self.pending))
                {
                    break;
                }
                output.push(self.pending.remove(0));
                if self.pending.is_empty() {
                    break;
                }
            }
            if self.processed >= MAX_STARTUP_BYTES {
                output.extend(self.finish());
            }
        }
        output
    }

    pub fn finish(&mut self) -> Vec<u8> {
        self.finished = true;
        std::mem::take(&mut self.pending)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_only_readline_startup_newline_across_every_chunk_boundary() {
        for newline in [b"\r\n".as_slice(), b"\r\r\n"] {
            let input = [
                b"Last login\r\nuser$ ",
                PASTE_END,
                newline,
                b"\r\x1b[2K",
                READY,
                b"user$ ",
                PASTE_END,
                newline,
            ]
            .concat();
            let expected = [
                b"Last login\r\nuser$ ",
                PASTE_END,
                b"\r\x1b[2Kuser$ ",
                PASTE_END,
                newline,
            ]
            .concat();
            for split in 0..=input.len() {
                let mut filter = ShellStartupOutput::default();
                let output = [
                    filter.push(&input[..split]),
                    filter.push(&input[split..]),
                    filter.finish(),
                ]
                .concat();
                assert_eq!(output, expected, "split={split}");
            }
            let mut filter = ShellStartupOutput::default();
            let output: Vec<_> = input
                .iter()
                .flat_map(|byte| filter.push(&[*byte]))
                .collect();
            assert_eq!(output, expected);
        }
    }

    #[test]
    fn preserves_banner_unicode_unrelated_controls_and_partial_sequences_at_eof() {
        let input = "欢迎\r\n\x1b[31muser$ \x1b[0m\r\n\x1b[?2004l\rX\x1b]777;other\x07\x1b]777;wmc"
            .as_bytes();
        let mut filter = ShellStartupOutput::default();
        assert_eq!([filter.push(input), filter.finish()].concat(), input);
    }

    #[test]
    fn fails_open_when_initialization_marker_is_missing() {
        let mut filter = ShellStartupOutput::default();
        let banner = vec![b'x'; MAX_STARTUP_BYTES];
        assert_eq!(filter.push(&banner), banner);
        let input = [PASTE_END, b"\r\n", READY].concat();
        assert_eq!(filter.push(&input), input);
    }
}
