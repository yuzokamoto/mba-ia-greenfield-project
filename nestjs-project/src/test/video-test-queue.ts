import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import {
  assertVideoTestEnvironment,
  VIDEO_TEST_QUEUE,
} from './video-test-environment';

export function createVideoTestQueue(): Queue {
  assertVideoTestEnvironment();
  const config = queueConfig();
  return new Queue(VIDEO_TEST_QUEUE, {
    connection: { ...config.connection, maxRetriesPerRequest: 1 },
  });
}

// Close independently running test consumers before invoking this cleanup.
export async function cleanVideoTestQueue(queue: Queue): Promise<void> {
  if (queue.name !== VIDEO_TEST_QUEUE) {
    throw new Error('Video test cleanup cannot remove a development queue');
  }
  await queue.obliterate({ force: true });
}
