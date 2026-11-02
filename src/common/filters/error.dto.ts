import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HealthServicesDto } from '../../modules/health/health.dto.js';

export class ErrorDetailDto {
  @ApiProperty({ example: 'SERVICE_UNAVAILABLE' })
  code!: string;

  @ApiProperty({ example: 'Un service est temporairement indisponible.' })
  message!: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ErrorDetailDto })
  error!: ErrorDetailDto;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/health' })
  path!: string;

  @ApiPropertyOptional({ type: HealthServicesDto })
  services?: HealthServicesDto;
}
