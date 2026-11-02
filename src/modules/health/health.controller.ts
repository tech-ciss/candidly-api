import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/filters/error.dto.js';
import { HealthResponseDto } from './health.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOkResponse({
    description: 'Application et dépendances disponibles.',
    type: HealthResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'Au moins une dépendance indisponible ; services indique up/down.',
    type: ErrorResponseDto,
  })
  check(): Promise<HealthResponseDto> {
    return this.health.check();
  }
}
