import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class IndexRepoDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/github\.com\/[^\/]+\/[^\/\s]+/, {
    message: 'repoUrl must be a valid GitHub repository URL, e.g. https://github.com/owner/repo',
  })
  repoUrl: string;
}