import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class QueryRepoDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'question must be at least 3 characters' })
  question: string;
}