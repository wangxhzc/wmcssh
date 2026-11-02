use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Condvar, Mutex};

type Job = Box<dyn FnOnce() + Send>;

#[derive(Default)]
struct Queue {
    jobs: VecDeque<(String, Job)>,
    active: HashSet<String>,
    stopped: bool,
}

/// Fixed worker pool with FIFO execution within each session.
pub struct TransferScheduler {
    shared: Arc<(Mutex<Queue>, Condvar)>,
}

impl TransferScheduler {
    pub fn new(concurrency: usize) -> std::io::Result<Self> {
        let scheduler = Self {
            shared: Arc::new((Mutex::new(Queue::default()), Condvar::new())),
        };
        for index in 0..concurrency.max(1) {
            let shared = scheduler.shared.clone();
            std::thread::Builder::new()
                .name(format!("sftp-worker-{index}"))
                .spawn(move || loop {
                    let (lock, ready) = &*shared;
                    let mut queue = lock.lock().unwrap();
                    let (key, job) = loop {
                        if queue.stopped && queue.jobs.is_empty() {
                            return;
                        }
                        if let Some(index) = queue
                            .jobs
                            .iter()
                            .position(|(key, _)| !queue.active.contains(key))
                        {
                            let (key, job) = queue.jobs.remove(index).unwrap();
                            queue.active.insert(key.clone());
                            break (key, job);
                        }
                        queue = ready.wait(queue).unwrap();
                    };
                    drop(queue);
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
                    lock.lock().unwrap().active.remove(&key);
                    ready.notify_all();
                })?;
        }
        Ok(scheduler)
    }

    pub fn submit(&self, key: String, job: impl FnOnce() + Send + 'static) -> std::io::Result<()> {
        let (lock, ready) = &*self.shared;
        let mut queue = lock.lock().unwrap();
        if queue.jobs.len() >= super::transfer_config::get().max_retained_tasks {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WouldBlock,
                "文件传输队列已满，请稍后重试",
            ));
        }
        queue.jobs.push_back((key, Box::new(job)));
        ready.notify_all();
        Ok(())
    }
}

impl Drop for TransferScheduler {
    fn drop(&mut self) {
        let (lock, ready) = &*self.shared;
        lock.lock().unwrap().stopped = true;
        ready.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn preserves_session_order_without_blocking_other_sessions() {
        let scheduler = TransferScheduler::new(2).unwrap();
        let (events, received) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let first = events.clone();
        scheduler
            .submit("a".into(), move || {
                first.send(1).unwrap();
                wait.recv_timeout(Duration::from_secs(5)).unwrap();
            })
            .unwrap();
        assert_eq!(received.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
        let second = events.clone();
        scheduler
            .submit("a".into(), move || {
                second.send(2).unwrap();
            })
            .unwrap();
        scheduler
            .submit("b".into(), move || {
                events.send(3).unwrap();
            })
            .unwrap();
        assert_eq!(received.recv_timeout(Duration::from_secs(5)).unwrap(), 3);
        release.send(()).unwrap();
        assert_eq!(received.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
    }
}
