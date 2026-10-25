import { Test } from '@nestjs/testing';
import { MediaInspectionModule } from './media-inspection.module';
import { MediaInspectionService } from './media-inspection.service';

describe('MediaInspectionModule', () => {
  it('should compile configured providers without external I/O', async () => {
    const module = await Test.createTestingModule({
      imports: [MediaInspectionModule],
    }).compile();
    expect(module.get(MediaInspectionService)).toBeInstanceOf(
      MediaInspectionService,
    );
    await module.close();
  });
});
